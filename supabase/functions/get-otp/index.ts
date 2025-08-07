/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
import Joi from "https://esm.sh/joi@17.9.2";
import responseMessage from '../_assets/responseMessages.ts';
import userService from '../_services/userService.ts';
import { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from "https://esm.sh/@supabase/supabase-js@2.42.0";
Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }
  
  const validationSchema = Joi.object().keys({
    email: Joi.string().email({ tlds: { allow: false } }).required()
  });
  try {
    if (req.method != 'POST') {
      return new Response(JSON.stringify({
        error: responseMessage.INVALID_REQUEST
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
    const body = await req.json();
    const { email } = await validationSchema.validateAsync(body);
    // Check if user exists in users table before proceeding
    const userExists = await userService.checkUserExists(email);
    if (!userExists) {
      return new Response(JSON.stringify({
        error: 'User not found. Please register first or contact support.'
      }), {
        headers: {
          ...corsHeaders, 
          'Content-Type': 'application/json'
        },
        status: 404
      });
    }
    // Check if user is blocked
    await userService.checkUserBlocked(email);
    const data = await userService.sendOtp(email);
    return new Response(JSON.stringify({
      message: 'OTP sent successfully'
    }), {
      headers: {
        ...corsHeaders, 
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    let errorMessage = '';
    let statusCode = 400;
    if (error instanceof FunctionsHttpError) {
      console.log('Function returned an error', error.message);
      errorMessage = await error.context.json();
    } else if (error instanceof FunctionsRelayError) {
      errorMessage = error.message;
      console.log('Relay error:', error.message);
    } else if (error instanceof FunctionsFetchError) {
      errorMessage = error.message;
      console.log('Fetch error:', error.message);
    } else {
      errorMessage = error.message;
      // Handle specific validation errors
      if (error.details && error.details[0]) {
        errorMessage = error.details[0].message;
      }
    }
    return new Response(JSON.stringify({
      error: errorMessage
    }), {
      headers: {
        ...corsHeaders, 
        'Content-Type': 'application/json'
      },
      status: statusCode
    });
  }
});