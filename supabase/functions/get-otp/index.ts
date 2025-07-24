/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
import Joi from "https://esm.sh/joi@17.9.2";
import responseMessage from '../_assets/responseMessages.ts';
import userService from '../_services/userService.ts';
import { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from "https://esm.sh/@supabase/supabase-js@2.42.0";
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
    //   const otp = await Util.generate4DigitOTP()
    //   let current_time = new Date();
    //   current_time.setMinutes(current_time.getMinutes() + 2);
    //   let expires_at = current_time.toISOString();
    //  const data = await userService.addOtp({email: body.email, otp_code: otp, expires_at: expires_at})
    await userService.checkUserBlocked(email);
    const data = await userService.sendOtp(email);
    return new Response(JSON.stringify({
      message: 'Otp sent successfully'
    }), {
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