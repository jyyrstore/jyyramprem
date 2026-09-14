function getSupabaseOrigin(){
  try {
    const raw=String(process.env.SUPABASE_URL||"").trim();
    if(!raw) return null;
    const url=new URL(raw.includes("://")?raw:`https://${raw}`);
    if(!["https:","http:"].includes(url.protocol)||!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export const securityHeaders=(req,res,next)=>{
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("X-Frame-Options","DENY");
  res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy","same-origin");

  const connectSources=["'self'"];
  const supabaseOrigin=getSupabaseOrigin();
  if(supabaseOrigin) connectSources.push(supabaseOrigin);

  // Inline event handlers are intentionally prohibited; index.html uses a
  // delegated image-error listener instead. Inline styles remain allowed
  // because the single shared shell still contains critical inline CSS.
  const csp=[
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://i.ibb.co.com https://cdn-icons-png.flaticon.com`,
    "font-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src ${connectSources.join(' ')}`
  ].join('; ');
  res.setHeader("Content-Security-Policy",csp);

  const forwardedProto=String(req.headers["x-forwarded-proto"]||"").split(",")[0].trim();
  if(process.env.NODE_ENV==="production"&&(req.secure||forwardedProto==="https"))
    res.setHeader("Strict-Transport-Security","max-age=31536000; includeSubDomains");
  next();
};

export const cachePolicy=(req,res,next)=>{if(req.path.endsWith(".html")||req.path==="/manifest.webmanifest"||req.path==="/service-worker.js"||req.path.startsWith("/api/"))res.setHeader("Cache-Control","no-store, max-age=0");next();};
export const staticHeaders=(res,filePath)=>{if(/\.(?:css|js)$/i.test(filePath))res.setHeader("Cache-Control","no-cache, no-store, must-revalidate");else if(/\.(?:svg|png|jpe?g|webp|woff2?|ttf|otf)$/i.test(filePath))res.setHeader("Cache-Control","public, max-age=86400, must-revalidate");};
