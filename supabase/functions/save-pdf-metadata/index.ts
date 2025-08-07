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
    s3Key: Joi.string().required(),
    filename: Joi.string().required(),
    originalFilename: Joi.string().required(),
    fileSize: Joi.number().integer().min(1).max(52428800).required(), // 50MB limit
    contentType: Joi.string().default('application/pdf'),
    metadata: Joi.object().default({})
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
    const { 
      s3Key, 
      filename, 
      originalFilename, 
      fileSize, 
      contentType,
      metadata 
    } = await validationSchema.validateAsync(body);

    // Verify the S3 key belongs to the current user
    if (!s3Key.startsWith(`pdfs/${user.id}/`)) {
      return new Response(JSON.stringify({
        error: 'Invalid S3 key for user'
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json'
        },
        status: 403
      });
    }

    // Insert the PDF metadata into the database
    const { data, error } = await supabaseClient
      .from('user_pdfs')
      .insert({
        user_id: user.id,
        filename: filename,
        original_filename: originalFilename,
        s3_key: s3Key,
        file_size: fileSize,
        content_type: contentType,
        sync_status: 'pending',
        metadata: metadata,
      })
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      
      // Check for duplicate key error
      if (error.code === '23505') {
        return new Response(JSON.stringify({
          error: 'File already exists'
        }), {
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json'
          },
          status: 409
        });
      }

      return new Response(JSON.stringify({
        error: 'Failed to save file metadata'
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json'
        },
        status: 500
      });
    }

    // Format the response data
    const responseData = {
      id: data.id,
      filename: data.filename,
      originalFilename: data.original_filename,
      fileSize: data.file_size,
      uploadedAt: data.uploaded_at,
      syncStatus: data.sync_status,
      s3Key: data.s3_key,
    };

    return new Response(JSON.stringify({
      success: true,
      message: 'File metadata saved successfully',
      data: responseData,
    }), {
      headers: {
        ...corsHeaders, 
        "Content-Type": "application/json"
      }
    });

  } catch (error) {
    console.error('Error saving PDF metadata:', error);
    
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