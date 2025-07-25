/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
import Joi from "https://esm.sh/joi@17.9.2";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  const validationSchema = Joi.object().keys({
    filename: Joi.string().required(),
    fileSize: Joi.number().integer().min(1).max(52428800).required(), // 50MB limit
    contentType: Joi.string().valid('application/pdf').required()
  });

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Invalid request method'
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Get the user from the JWT token
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({
        error: 'Unauthorized'
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json'
        },
        status: 401
      });
    }

    const body = await req.json();
    const { filename, fileSize, contentType } = await validationSchema.validateAsync(body);

    // Sanitize filename
    const sanitizedFilename = filename
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/_{2,}/g, '_')
      .toLowerCase();

    // Generate unique S3 key
    const timestamp = Math.floor(Date.now() / 1000);
    const s3Key = `pdfs/${user.id}/${timestamp}_${sanitizedFilename}`;

    // Generate pre-signed URL using AWS API directly
    const awsAccessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID');
    const awsSecretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY');
    const awsRegion = Deno.env.get('AWS_REGION') ?? 'us-east-1';
    const bucketName = Deno.env.get('S3_BUCKET_NAME');

    if (!awsAccessKeyId || !awsSecretAccessKey || !bucketName) {
      throw new Error('Missing required AWS configuration');
    }

    // Create pre-signed URL using AWS Signature Version 4
    const expirationTime = Math.floor(Date.now() / 1000) + (15 * 60); // 15 minutes
    const host = `${bucketName}.s3.${awsRegion}.amazonaws.com`;
    const url = `https://${host}/${s3Key}`;

    // For simplicity, we'll use a basic pre-signed URL generation
    // In production, you might want to use a more robust AWS SDK or signing library
    const presignedUrl = await generatePresignedUrl({
      accessKeyId: awsAccessKeyId,
      secretAccessKey: awsSecretAccessKey,
      region: awsRegion,
      bucketName: bucketName,
      objectKey: s3Key,
      expirationTime: expirationTime,
      contentType: contentType,
      contentLength: fileSize
    });

    return new Response(JSON.stringify({
      success: true,
      data: {
        uploadUrl: presignedUrl,
        s3Key: s3Key,
        filename: sanitizedFilename,
        originalFilename: filename,
        fileSize: fileSize,
        contentType: contentType,
        expiresIn: 15 * 60, // 15 minutes
      }
    }), {
      headers: {
        ...corsHeaders, 
        "Content-Type": "application/json"
      }
    });

  } catch (error) {
    console.error('Error generating upload URL:', error);
    
    return new Response(JSON.stringify({
      error: error.message || 'Internal server error'
    }), {
      headers: {
        ...corsHeaders, 
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});

// Helper function to generate pre-signed URL using AWS Signature Version 4
async function generatePresignedUrl(params: {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucketName: string;
  objectKey: string;
  expirationTime: number;
  contentType: string;
  contentLength: number;
}): Promise<string> {
  const {
    accessKeyId,
    secretAccessKey,
    region,
    bucketName,
    objectKey,
    expirationTime,
    contentType,
    contentLength
  } = params;

  // Create the URL without query parameters first
  const host = `${bucketName}.s3.${region}.amazonaws.com`;
  // const baseUrl = `https://${host}/${encodeURIComponent(objectKey)}`;
  const baseUrl = `https://${host}/${objectKey}`; // slashes NOT encoded

  // AWS Signature Version 4 parameters
  const algorithm = 'AWS4-HMAC-SHA256';
  const date = new Date();
  const dateStamp = date.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = date.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const credential = `${accessKeyId}/${credentialScope}`;

  // Query parameters for pre-signed URL
  const queryParams = new URLSearchParams({
    'X-Amz-Algorithm': algorithm,
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': '900', // 15 minutes
    // 'X-Amz-SignedHeaders': 'Content-Type;host'
    'X-Amz-SignedHeaders': 'content-type;host'
  });

  // Create canonical request
  const canonicalUri = `/${objectKey}`; 
  const canonicalQueryString = queryParams.toString();
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  // Create string to sign
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256(canonicalRequest)
  ].join('\n');

  // Calculate signature
  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, 's3');
  const signature = await hmacSha256(signingKey, stringToSign);

  // Add signature to query parameters
  queryParams.set('X-Amz-Signature', signature);

  return `${baseUrl}?${queryParams.toString()}`;
}

// Helper functions for AWS signature calculation
async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key: Uint8Array, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  const signatureArray = Array.from(new Uint8Array(signature));
  return signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Promise<Uint8Array> {
  const kDate = await hmacSha256Raw(new TextEncoder().encode('AWS4' + key), dateStamp);
  const kRegion = await hmacSha256Raw(kDate, regionName);
  const kService = await hmacSha256Raw(kRegion, serviceName);
  const kSigning = await hmacSha256Raw(kService, 'aws4_request');
  return kSigning;
}

async function hmacSha256Raw(key: Uint8Array, message: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return new Uint8Array(signature);
}