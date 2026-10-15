// Vercel Node.js serverless function. Same-origin proxy avoids browser CORS errors.
const ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter'
];
const RADIUS_METERS = 32186.9;
function reply(res,status,data){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control',status===200?'public, s-maxage=120, stale-while-revalidate=300':'no-store');
  return res.status(status).json(data);
}
module.exports = async function handler(req,res){
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return reply(res,405,{error:'Method not allowed.'});
  }
  const {lat:rawLat,lon:rawLon}=req.query;
  const lat=Number(rawLat),lon=Number(rawLon);
  if(typeof rawLat!=='string'||typeof rawLon!=='string'||!rawLat.trim()||!rawLon.trim()||
     !Number.isFinite(lat)||!Number.isFinite(lon)||lat < -90||lat > 90||lon < -180||lon > 180){
    return reply(res,400,{error:'A valid location is required.'});
  }
  const query=`[out:json][timeout:22];(nwr["amenity"~"^(restaurant|cafe|fast_food|ice_cream)$"](around:${RADIUS_METERS},${lat},${lon});nwr["shop"~"^(bakery|confectionery)$"](around:${RADIUS_METERS},${lat},${lon}););out center;`;
  for(const endpoint of ENDPOINTS){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
        body:new URLSearchParams({data:query}).toString(),
        signal:controller.signal
      });
      if(!response.ok)continue;
      const data=await response.json();
      if(data&&Array.isArray(data.elements))return reply(res,200,{elements:data.elements});
    }catch(_err){ /* Fallback to the next server. */ }
    finally{clearTimeout(timer);}
  }
  return reply(res,503,{error:'Restaurant search servers are busy. Please try again shortly.'});
};
