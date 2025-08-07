/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
import Joi from "https://esm.sh/joi@17.9.2";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'
import { authenticateUser, getCorsHeaders } from '../_shared/authUtils.ts'

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders();

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  const validationSchema = Joi.object().keys({
    fileId: Joi.string().uuid().required(),
    updateMethod: Joi.string().valid('replace', 'version').default('replace'),
    metadata: Joi.object().optional()
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

    // Authenticate user using shared utility
    let user: any;
    try {
      user = await authenticateUser(req);
    } catch (authError) {
      return new Response(JSON.stringify({
        error: authError.message
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json'
        },
        status: 401
      });
    }

    const body = await req.json();
    const { fileId, updateMethod, metadata } = await validationSchema.validateAsync(body);

    // Fetch the existing file from database to get S3 key
    const { data: fileData, error: fileError } = await supabaseClient
      .from('user_pdfs')
      .select('id, s3_key, filename, original_filename, file_size, user_id')
      .eq('id', fileId)
      .eq('user_id', user.id) // Ensure user owns the file
      .single();

    if (fileError || !fileData) {
      return new Response(JSON.stringify({
        error: 'File not found or you do not have permission to update it'
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json'
        },
        status: 404
      });
    }

    // Check if file is currently being updated (optional - prevent conflicts)
    const { data: lockData } = await supabaseClient
      .from('user_pdfs')
      .select('sync_status')
      .eq('id', fileId)
      .single();

    if (lockData?.sync_status === 'updating') {
      return new Response(JSON.stringify({
        error: 'File is currently being updated by another device'
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json'
        },
        status: 409
      });
    }

    // Update sync status to 'updating' to prevent conflicts
    await supabaseClient
      .from('user_pdfs')
      .update({ 
        sync_status: 'updating',
        updated_at: new Date().toISOString()
      })
      .eq('id', fileId);

    // Use the EXISTING S3 key (this is the key difference from get-upload-url)
    const existingS3Key = fileData.s3_key;

    // Get AWS configuration
    const awsAccessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID');
    const awsSecretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY');
    const awsRegion = Deno.env.get('AWS_REGION') ?? 'us-east-1';
    const bucketName = Deno.env.get('S3_BUCKET_NAME');

    if (!awsAccessKeyId || !awsSecretAccessKey || !bucketName) {
      throw new Error('Missing required AWS configuration');
    }

    // Generate pre-signed URL for the EXISTING S3 key
    const presignedUrl = await generatePresignedUrl({
      accessKeyId: awsAccessKeyId,
      secretAccessKey: awsSecretAccessKey,
      region: awsRegion,
      bucketName: bucketName,
      objectKey: existingS3Key,
      expirationTime: Math.floor(Date.now() / 1000) + (15 * 60), // 15 minutes
      contentType: 'application/pdf',
      contentLength: 52428800 // 50MB max
    });

    // Optionally store update metadata
    if (metadata) {
      await supabaseClient
        .from('user_pdfs')
        .update({ 
          metadata: metadata,
          updated_at: new Date().toISOString()
        })
        .eq('id', fileId);
    }

    return new Response(JSON.stringify({
      success: true,
      data: {
        uploadUrl: presignedUrl,
        s3Key: existingS3Key,
        fileId: fileId,
        updateMethod: updateMethod,
        expiresIn: 15 * 60, // 15 minutes
        maxFileSize: 52428800, // 50MB
        expectedContentType: 'application/pdf'
      }
    }), {
      headers: {
        ...corsHeaders, 
        "Content-Type": "application/json"
      }
    });

  } catch (error) {
    console.error('Error generating update URL:', error);
    
    return new Response(JSON.stringify({
      error: error.message || 'Failed to prepare file update'
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
// (Same as get-upload-url - reusing the exact same function)
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
// (Same as get-upload-url - reusing exact same functions)
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