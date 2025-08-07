# Dual Authentication Support for S3 APIs

This guide documents how all S3-related APIs now support both **Bearer Token Authentication** (for web dashboard) and **Device ID Authentication** (for Android tablets).

## Updated APIs

The following APIs now support dual authentication:

1. **get-upload-url** - Generate pre-signed S3 URL for uploads
2. **get-download-url** - Generate pre-signed S3 URL for downloads  
3. **save-pdf-metadata** - Save metadata after S3 upload
4. **delete-pdf** - Delete files from S3 and database
5. **update-pdf** - Update existing PDF files
6. **get-user-files** - Retrieve user's PDF files

## Authentication Methods

### 1. Bearer Token Authentication (Web Dashboard)
Use this method for web applications where users are logged in with JWT tokens.

**Headers:**
```
Authorization: Bearer <your-jwt-token>
```

### 2. Device ID Authentication (Tablets)
Use this method for Android tablets where you want to authenticate using a device ID.

**Headers:**
```
X-Device-ID: <device-id>
```

**Or as Query Parameter:**
```
?deviceId=<device-id>
```

## API Usage Examples

### Get Upload URL

**Web Dashboard:**
```bash
curl -X POST "https://your-project.supabase.co/functions/v1/get-upload-url" \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "document.pdf",
    "fileSize": 2048000,
    "contentType": "application/pdf"
  }'
```

**Android Tablet:**
```bash
curl -X POST "https://your-project.supabase.co/functions/v1/get-upload-url" \
  -H "X-Device-ID: tablet-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "document.pdf",
    "fileSize": 2048000,
    "contentType": "application/pdf"
  }'
```

### Get Download URL

**Web Dashboard:**
```bash
curl -X POST "https://your-project.supabase.co/functions/v1/get-download-url" \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

**Android Tablet:**
```bash
curl -X POST "https://your-project.supabase.co/functions/v1/get-download-url" \
  -H "X-Device-ID: tablet-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

### Save PDF Metadata

**Web Dashboard:**
```bash
curl -X POST "https://your-project.supabase.co/functions/v1/save-pdf-metadata" \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "s3Key": "pdfs/user123/1704067200_document.pdf",
    "filename": "document.pdf",
    "originalFilename": "My Document.pdf",
    "fileSize": 2048000,
    "contentType": "application/pdf"
  }'
```

**Android Tablet:**
```bash
curl -X POST "https://your-project.supabase.co/functions/v1/save-pdf-metadata" \
  -H "X-Device-ID: tablet-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "s3Key": "pdfs/user123/1704067200_document.pdf",
    "filename": "document.pdf",
    "originalFilename": "My Document.pdf",
    "fileSize": 2048000,
    "contentType": "application/pdf"
  }'
```

### Delete PDF

**Web Dashboard:**
```bash
curl -X POST "https://your-project.supabase.co/functions/v1/delete-pdf" \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

**Android Tablet:**
```bash
curl -X POST "https://your-project.supabase.co/functions/v1/delete-pdf" \
  -H "X-Device-ID: tablet-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

### Update PDF

**Web Dashboard:**
```bash
curl -X POST "https://your-project.supabase.co/functions/v1/update-pdf" \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "550e8400-e29b-41d4-a716-446655440000",
    "updateMethod": "replace",
    "metadata": {
      "hasAnnotations": true,
      "lastModifiedDevice": "tablet_001"
    }
  }'
```

**Android Tablet:**
```bash
curl -X POST "https://your-project.supabase.co/functions/v1/update-pdf" \
  -H "X-Device-ID: tablet-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "550e8400-e29b-41d4-a716-446655440000",
    "updateMethod": "replace",
    "metadata": {
      "hasAnnotations": true,
      "lastModifiedDevice": "tablet_001"
    }
  }'
```

### Get User Files

**Web Dashboard:**
```bash
curl -X GET "https://your-project.supabase.co/functions/v1/get-user-files?limit=20" \
  -H "Authorization: Bearer <jwt-token>"
```

**Android Tablet:**
```bash
curl -X GET "https://your-project.supabase.co/functions/v1/get-user-files?limit=20" \
  -H "X-Device-ID: tablet-12345"
```

Or using query parameter:
```bash
curl -X GET "https://your-project.supabase.co/functions/v1/get-user-files?limit=20&deviceId=tablet-12345"
```

## Database Requirements

For device authentication to work, you need a `devices` table with the following structure:

```sql
CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Error Responses

All APIs return consistent error responses for authentication failures:

### Invalid Device ID
```json
{
  "error": "Invalid device ID"
}
```

### User Not Found for Device
```json
{
  "error": "User not found for device"
}
```

### Authorization Required
```json
{
  "error": "Authorization header required"
}
```

### Unauthorized
```json
{
  "error": "Unauthorized"
}
```

## Implementation Details

### Shared Authentication Utility

All APIs now use the shared authentication utility (`_shared/authUtils.ts`):

```typescript
import { authenticateUser, getCorsHeaders } from '../_shared/authUtils.ts'

// Use shared CORS headers
const corsHeaders = getCorsHeaders();

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
```

### Authentication Priority

The authentication logic follows this priority:

1. **Device ID Authentication**: Check for `X-Device-ID` header or `deviceId` query parameter
2. **Bearer Token Authentication**: Fall back to JWT token authentication

### CORS Headers

All APIs now include the `X-Device-ID` header in CORS configuration:

```typescript
{
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Device-ID"
}
```

## Benefits

1. **Backward Compatible**: Existing web dashboard functionality unchanged
2. **Flexible**: Device ID can be passed via header or query parameter
3. **Consistent**: All APIs use the same authentication pattern
4. **Secure**: Proper error handling for invalid device IDs
5. **Reusable**: Shared authentication utility across all APIs

## Migration Guide

### For Web Dashboard
No changes required - continue using Bearer token authentication.

### For Android Tablets
1. **Register devices** in the `devices` table
2. **Use device ID** in requests instead of JWT tokens
3. **Update client code** to send `X-Device-ID` header or `deviceId` query parameter

### Example Device Registration
```sql
INSERT INTO devices (device_id, user_id) 
VALUES ('tablet-12345', 'user-uuid-here');
``` 