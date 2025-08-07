/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'
import { authenticateUser, getCorsHeaders } from '../_shared/authUtils.ts'

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders();
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    if (req.method !== 'GET') {
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

    // Parse query parameters for pagination and filtering
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const search = url.searchParams.get('search') || '';
    const sortBy = url.searchParams.get('sortBy') || 'uploaded_at';
    const sortOrder = url.searchParams.get('sortOrder') || 'desc';

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

    // Build the query
    let query = supabaseClient
      .from('user_pdfs')
      .select('*')
      .eq('user_id', user!.id);

    // Add search filter if provided
    if (search) {
      query = query.ilike('original_filename', `%${search}%`);
    }

    // Add sorting
    const validSortColumns = ['uploaded_at', 'original_filename', 'file_size', 'sync_status'];
    const validSortOrders = ['asc', 'desc'];
    
    if (validSortColumns.includes(sortBy) && validSortOrders.includes(sortOrder)) {
      query = query.order(sortBy, { ascending: sortOrder === 'asc' });
    } else {
      query = query.order('uploaded_at', { ascending: false });
    }

    // Add pagination
    query = query.range(offset, offset + limit - 1);

    // Execute the query
    const { data: files, error } = await query;

    if (error) {
      console.error('Database error:', error);
      return new Response(JSON.stringify({
        error: 'Failed to fetch files'
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json'
        },
        status: 500
      });
    }

    // Get AWS credentials for generating download URLs
    const awsAccessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID');
    const awsSecretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY');
    const awsRegion = Deno.env.get('AWS_REGION') ?? 'us-east-1';
    const bucketName = Deno.env.get('S3_BUCKET_NAME');

    // Format the files data and generate download URLs
    const formattedFiles = await Promise.all(
      (files || []).map(async (file) => {
        let downloadUrl = null;
        
        try {
          // Generate pre-signed download URL (expires in 1 hour)
          if (awsAccessKeyId && awsSecretAccessKey && bucketName) {
            downloadUrl = await generateDownloadUrl({
              accessKeyId: awsAccessKeyId,
              secretAccessKey: awsSecretAccessKey,
              region: awsRegion,
              bucketName: bucketName,
              objectKey: file.s3_key,
              expirationTime: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour
            });
          }
        } catch (s3Error) {
          console.error('Error generating download URL for file:', file.id, s3Error);
          // Continue without download URL if S3 error occurs
        }

        return {
          id: file.id,
          filename: file.original_filename,
          sanitizedFilename: file.filename,
          fileSize: file.file_size,
          fileSizeFormatted: formatFileSize(file.file_size),
          uploadDate: file.uploaded_at,
          uploadDateFormatted: formatUploadDate(file.uploaded_at),
          syncStatus: file.sync_status,
          deviceCount: file.device_count,
          lastSyncedAt: file.last_synced_at,
          syncErrorMessage: file.sync_error_message,
          downloadUrl: downloadUrl,
          s3Key: file.s3_key,
          metadata: file.metadata,
        };
      })
    );

    // Get total count for pagination
    const { count: totalCount } = await supabaseClient
      .from('user_pdfs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    return new Response(JSON.stringify({
      success: true,
      data: {
        files: formattedFiles,
        pagination: {
          total: totalCount || 0,
          limit: limit,
          offset: offset,
          hasMore: (offset + limit) < (totalCount || 0),
        },
      },
    }), {
      headers: {
        ...corsHeaders, 
        "Content-Type": "application/json"
      }
    });

  } catch (error) {
    console.error('Error fetching user files:', error);
    
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

// Helper function to generate pre-signed download URL
async function generateDownloadUrl(params: {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucketName: string;
  objectKey: string;
  expirationTime: number;
}): Promise<string> {
  const {
    accessKeyId,
    secretAccessKey,
    region,
    bucketName,
    objectKey,
    expirationTime
  } = params;

  // Create the URL without query parameters first
  const host = `${bucketName}.s3.${region}.amazonaws.com`;
  const baseUrl = `https://${host}/${encodeURIComponent(objectKey)}`;

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
    'X-Amz-Expires': '3600', // 1 hour
    'X-Amz-SignedHeaders': 'host'
  });

  // Create canonical request
  const canonicalUri = `/${encodeURIComponent(objectKey)}`;
  const canonicalQueryString = queryParams.toString();
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    'GET',
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

// Helper functions for file formatting
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUploadDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 1) return 'Today';
  if (diffDays === 2) return 'Yesterday';
  if (diffDays <= 7) return `${diffDays - 1} days ago`;

  return date.toLocaleDateString();
}

// Helper functions for AWS signature calculation (same as upload function)
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