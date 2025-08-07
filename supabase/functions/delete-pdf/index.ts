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
    fileId: Joi.string().uuid().required()
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
    const { fileId } = await validationSchema.validateAsync(body);

    // First, get the file record to verify ownership and get S3 key
    const { data: fileRecord, error: fetchError } = await supabaseClient
      .from('user_pdfs')
      .select('s3_key, original_filename')
      .eq('id', fileId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !fileRecord) {
      return new Response(JSON.stringify({
        error: 'File not found or you do not have permission to delete it'
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json'
        },
        status: 404
      });
    }

    // Get AWS credentials
    const awsAccessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID');
    const awsSecretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY');
    const awsRegion = Deno.env.get('AWS_REGION') ?? 'us-east-1';
    const bucketName = Deno.env.get('S3_BUCKET_NAME');

    let s3DeleteSuccess = false;
    let s3DeleteError = null;

    // Try to delete from S3 if we have AWS credentials
    if (awsAccessKeyId && awsSecretAccessKey && bucketName) {
      try {
        await deleteFromS3({
          accessKeyId: awsAccessKeyId,
          secretAccessKey: awsSecretAccessKey,
          region: awsRegion,
          bucketName: bucketName,
          objectKey: fileRecord.s3_key
        });
        s3DeleteSuccess = true;
      } catch (s3Error) {
        console.error('S3 delete error:', s3Error);
        s3DeleteError = s3Error.message;
        // Continue with database deletion even if S3 deletion fails
      }
    }

    // Delete the record from the database
    const { error: deleteError } = await supabaseClient
      .from('user_pdfs')
      .delete()
      .eq('id', fileId)
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('Database delete error:', deleteError);
      
      return new Response(JSON.stringify({
        error: 'Failed to delete file record from database'
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json'
        },
        status: 500
      });
    }

    // Prepare response
    let message = 'File deleted successfully';
    const warnings = [];

    if (!s3DeleteSuccess && s3DeleteError) {
      message = 'File record deleted from database, but S3 deletion failed';
      warnings.push(`S3 deletion failed: ${s3DeleteError}`);
    }

    return new Response(JSON.stringify({
      success: true,
      message: message,
      data: {
        fileId: fileId,
        filename: fileRecord.original_filename,
        s3DeleteSuccess: s3DeleteSuccess,
        warnings: warnings,
      },
    }), {
      headers: {
        ...corsHeaders, 
        "Content-Type": "application/json"
      }
    });

  } catch (error) {
    console.error('Error deleting PDF:', error);
    
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

// Helper function to delete object from S3
async function deleteFromS3(params: {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucketName: string;
  objectKey: string;
}): Promise<void> {
  const {
    accessKeyId,
    secretAccessKey,
    region,
    bucketName,
    objectKey
  } = params;

  // Create the URL for the DELETE request
  const host = `${bucketName}.s3.${region}.amazonaws.com`;
  const url = `https://${host}/${encodeURIComponent(objectKey)}`;

  // AWS Signature Version 4 parameters
  const algorithm = 'AWS4-HMAC-SHA256';
  const date = new Date();
  const dateStamp = date.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = date.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const credential = `${accessKeyId}/${credentialScope}`;

  // Create canonical request
  const canonicalUri = `/${encodeURIComponent(objectKey)}`;
  const canonicalQueryString = '';
  const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-date';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    'DELETE',
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

  // Create authorization header
  const authorizationHeader = `${algorithm} Credential=${credential}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // Make the DELETE request
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Host': host,
      'X-Amz-Date': amzDate,
      'Authorization': authorizationHeader
    }
  });

  if (!response.ok) {
    throw new Error(`S3 delete failed: ${response.status} ${response.statusText}`);
  }
}

// Helper functions for AWS signature calculation (same as other functions)
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