import { supabase } from '../_shared/createClient.ts';
import ApiError from '../_shared/apiError.ts';
const { badRequest, notFound } = ApiError;
let userService = {
  signInWithPassword: async (email, password)=>{
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    // const { data, error } = await supabase.auth.signInWithOtp({
    //   email,
    //   options: {
    //     emailRedirectTo: 'https://example.com/welcome'
    //   }
    // })
    console.log('data-------', data);
    console.log('error-------', error);
    if (error) {
      throw badRequest(error.message);
    }
    return data;
  },
  addOtp: async (insertObj)=>{
    const otp = await supabase.from('otps').select().eq('email', insertObj.email).gt('expires_at', new Date().toISOString());
    if (otp.error) {
      throw badRequest(otp.error.message);
    }
    if (otp.data) {
      const { error } = await supabase.from('otps').update(insertObj).eq('id', otp.data.id);
      if (error) {
        throw badRequest(error.message);
      }
      return;
    }
    const { data, error } = await supabase.from('otps').insert([
      {
        email: body.email,
        otp_code: otp,
        expires_at: expires_at
      }
    ]).select();
    if (error) {
      throw badRequest(error.message);
    }
    return data;
  },
  getOtp: async (email)=>{
    const { data, error } = await supabase.from('otps').select().eq('email', email).gt('expires_at', new Date().toISOString());
    if (error) {
      throw badRequest(error.message);
    }
    return data;
  },
  signupUser: async (email, password)=>{
    console.log('@@@', email, password);
    const { data, error } = await supabase.auth.signUp({
      email,
      password
    });
    console.log('data-------', data);
    console.log('error-----', error);
    if (error) {
      throw badRequest(error.message);
    }
    return data;
  },
  createProfile: async (insertObj)=>{
    const { data, error } = await supabase.from('users').insert(insertObj);
    if (error) {
      throw badRequest(error.message);
    }
    return data;
  },
  resetPassword: async (email)=>{
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://localhost:3000'
    });
    console.log('error------>', error);
    console.log('data------>', data);
    if (error) {
      throw badRequest(error.message);
    }
    return data;
  },
  changepassword: async (new_password)=>{
    const { data, error } = await supabase.auth.updateUser({
      password: new_password
    });
    if (error) {
      throw badRequest(error.message);
    }
    return data;
  },
  updateUser: async (id, updateObj)=>{
    const { data, error } = await supabase.from('users').update(updateObj).eq('id', id).select();
    if (error) {
      throw badRequest(error.message);
    }
    return data;
  },
  updateAdminUser: async (id, updateObj)=>{
    const { data, error } = await supabase.from('admins').update(updateObj).eq('id', id).select();
    if (error) {
      throw badRequest(error.message);
    }
    return data;
  },
  sendOtp: async (email)=>{
    const { data, error } = await supabase.auth.signInWithOtp({
      email
    });
    if (error) {
      throw badRequest(error.message);
    }
    return data;
  },
  verifyOtp: async (email, token)=>{
    const result = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email'
    });
    return result;
  },
  upsertOtpAttempt: async (email)=>{
    const { data, error } = await supabase.from('status').select().eq('email', email);
    if (data && data.length) {
      if (data[0].wrong_attempts >= 3) {
        let current_time = new Date();
        current_time.setMinutes(current_time.getMinutes() + 5);
        let temporary_blocked = current_time.toISOString();
        await supabase.from('status').update({
          wrong_attempts: data[0].wrong_attempts + 1,
          temporary_blocked: temporary_blocked
        }).eq('email', email);
        throw badRequest('User blocked due to wrong attempts');
      }
      await supabase.from('status').update({
        wrong_attempts: data[0].wrong_attempts + 1
      }).eq('email', email);
      return;
    }
    await supabase.from('status').insert({
      email: email,
      wrong_attempts: 1
    });
    return;
  },
  checkUserBlocked: async (email)=>{
    const { data: data1, error: error1 } = await supabase.from('status').select().eq('email', email).gte('is_blocked', true);
    if (error1) {
      throw badRequest(error.message);
    }
    if (data1 && data1.length) {
      throw badRequest('User is blocked');
    }
    let current_time = new Date();
    let curr_time = current_time.toISOString();
    const { data, error } = await supabase.from('status').select().eq('email', email).gte('temporary_blocked', curr_time);
    if (error) {
      throw badRequest(error.message);
    }
    if (data && data.length) {
      throw badRequest('User is blocked. Please try after 5 minutes');
    }
    return;
  },
  resetOtpAttemts: async (email)=>{
    await supabase.from('status').update({
      wrong_attempts: 0
    }).eq('email', email);
    return;
  }
};
export default userService = userService;
