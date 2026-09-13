export function registerErrorMiddleware(app){
  app.use("/api",(_req,res)=>res.status(404).json({ok:false,error:"API endpoint tidak ditemukan."}));
  app.use((req,res)=>{
    if(req.accepts("html"))return res.status(404).send(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>404 • Jyy'R Amprem</title></head><body style="font-family:system-ui;background:#08060d;color:#fff;display:grid;place-items:center;min-height:100vh"><main><h1>404</h1><p>Halaman tidak ditemukan.</p><a href="/" style="color:#b58cff">Kembali ke beranda</a></main></body></html>`);
    return res.status(404).json({ok:false,error:"Resource tidak ditemukan."});
  });
  app.use((err,req,res,next)=>{
    if(res.headersSent)return next(err);
    const status=Number.isInteger(err?.status)&&err.status>=400&&err.status<500?err.status:500;
    const isApi=String(req.path||req.originalUrl||"").startsWith("/api/")||String(req.originalUrl||"")==="/api";
    console.error("[UNHANDLED ERROR]",{status,code:err?.code||null,type:err?.type||null,message:err?.message||"Unknown error"});
    if(isApi){
      const message=status===400?"Permintaan tidak valid.":status===413?"Permintaan terlalu besar.":"Terjadi kesalahan pada server.";
      return res.status(status).json({ok:false,error:message});
    }
    return res.status(status).send("<!doctype html><html lang=\"id\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>500 • Jyy'R Amprem</title></head><body style=\"font-family:system-ui;background:#08060d;color:#fff;display:grid;place-items:center;min-height:100vh\"><main><h1>Terjadi kesalahan.</h1><p>Permintaan tidak dapat diproses.</p><a href=\"/\" style=\"color:#b58cff\">Kembali ke beranda</a></main></body></html>");
  });
}
