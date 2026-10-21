const B='http://127.0.0.1:18791';const h={'content-type':'application/json',origin:B};
let r=await fetch(B+'/api/login',{method:'POST',headers:h,body:JSON.stringify({password:'demo-ensaio-2026'})});h.cookie=r.headers.get('set-cookie').split(';')[0];
const s=await (await fetch(B+'/api/state',{headers:h})).json();
const fix={"Wonderwall (Live at Knebworth, 10 August '96)":{title:'Wonderwall'},'Lanterna Dos Afogados':{title:'Lanterna dos Afogados'},'Pais E Filhos':{title:'Pais e Filhos'},'Seven Nation Army':{tuning:'Padrão'}};
for(const x of s.songs) if(fix[x.title]){const res=await fetch(B+'/api/songs/'+x.id,{method:'PATCH',headers:h,body:JSON.stringify(fix[x.title])});console.log(x.title,res.status)}
