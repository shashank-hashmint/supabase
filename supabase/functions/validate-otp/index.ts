/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
import Joi from 'joi';
import responseMessage from '../_assets/responseMessages.ts';
import userService from '../_services/userService.ts';
import { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from "https://esm.sh/@supabase/supabase-js@2.42.0";
import ApiError from '../_shared/apiError.ts';
const { badRequest, notFound } = ApiError;
Deno.serve(async (req)=>{
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  const validationSchema = Joi.object().keys({
    email: Joi.string().email().required(),
    otp: Joi.string().required()
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
    const { email, otp } = await validationSchema.validateAsync(body);
    await userService.checkUserBlocked(email);
    const result = await userService.verifyOtp(email, otp);
    let data;
    if (result.error) {
      if (result.error.code === "otp_expired") await userService.upsertOtpAttempt(email);
      throw badRequest(result.error.message);
    }
    await userService.resetOtpAttemts(email);
    return new Response(JSON.stringify(result.data), {
      headers: {
        ...corsHeaders, 
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    let errorMessage = '';
    if (error instanceof FunctionsHttpError) {
      console.log('Function returned an error', errorMessage);
      errorMessage = await error.context.json();
    } else if (error instanceof FunctionsRelayError) {
      errorMessage = error.message;
      console.log('Relay error:', error.message);
    } else if (error instanceof FunctionsFetchError) {
      errorMessage = error.message;
      console.log('Fetch error:', error.message);
    } else {
      errorMessage = error.message;
    }
    return new Response(JSON.stringify({
      error: errorMessage
    }), {
      headers: {
        ...corsHeaders, 
        'Content-Type': 'application/json'
      },
      status: 400
    });
  }
});
