import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'

export interface AuthenticatedUser {
  id: string;
  email?: string;
  full_name?: string;
}

export async function authenticateUser(req: Request): Promise<AuthenticatedUser> {
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: {
        headers: { Authorization: req.headers.get('Authorization')! },
      },
    }
  );

  // Check for deviceId authentication first
  const deviceId = req.headers.get('X-Device-ID');

  if (deviceId) {
    // Device authentication - look up user by deviceId
    const { data: deviceData, error: deviceError } = await supabaseClient
      .from('user_devices')
      .select('user_id')
      .eq('device_id', deviceId)
      .single();

    if (deviceError || !deviceData) {
      throw new Error('Invalid device ID');
    }

    // Get user details by user_id
    const { data: userData, error: userLookupError } = await supabaseClient
      .from('users')
      .select('id, email, full_name')
      .eq('id', deviceData.user_id)
      .single();

    if (userLookupError || !userData) {
      throw new Error('User not found for device');
    }
    return userData;
  } else {
    // Bearer token authentication
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Authorization header required');
    }

    // Get the user from the JWT token
    const {
      data: { user: authUser },
      error: tokenAuthError,
    } = await supabaseClient.auth.getUser();

    if (tokenAuthError || !authUser) {
      throw new Error('Unauthorized');
    }

    return authUser;
  }
}

export function getCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Device-ID"
  };
} 