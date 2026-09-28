const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const OpenAI = require("openai");

const app = express();
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req,res,next)=>{
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("X-Frame-Options","DENY");
  res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
  next();
});
const PORT = process.env.PORT || 3000;
const db = new Database(path.join(__dirname, process.env.DB_PATH || "estoque.db"));

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8*60*60*1000
  }
}));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','user')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 variant TEXT NOT NULL DEFAULT 'Padrão',
 qty INTEGER NOT NULL DEFAULT 0,
 min_qty INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS movements (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 product_id INTEGER,
 type TEXT NOT NULL CHECK(type IN ('in','out')),
 qty INTEGER NOT NULL,
 ref TEXT,
 note TEXT,
 user_id INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(product_id) REFERENCES products(id),
 FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

try { db.prepare("ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1").run(); } catch(e) {}

const adminName = process.env.ADMIN_NAME || "Red Way";
const adminPassword = process.env.ADMIN_PASSWORD || "25198615";
const adminHash = bcrypt.hashSync(adminPassword, 12);
const existingAdmin = db.prepare("SELECT id FROM users WHERE username=?").get("redway");
if (!existingAdmin) {
  db.prepare("INSERT INTO users(name,username,password_hash,role) VALUES(?,?,?,'admin')")
    .run(adminName, "redway", adminHash);
}

const count = db.prepare("SELECT COUNT(*) c FROM products").get().c;
if (!count) {
  const seed = [
    ["Botão de ferro","Padrão",500,100],["Coquinho","Padrão",300,80],
    ["Courinho","Azul",120,30],["Courinho","Preto",150,30],["Courinho","Marrom",90,30],
    ["Zíper 15 cm","Bege",200,50],["Zíper 15 cm","Caqui",180,50],["Zíper 15 cm","Azul",150,50],
    ["Zíper 15 cm","Cinza",130,50],["Zíper 15 cm","Preto",250,50],
    ["Caixa de fósforo","Reta",100,25],["Caixa de fósforo","Slim",100,25],
    ["Tag","Padrão",500,100],["Lixa","Padrão",40,10],["Cola","Padrão",20,5],
    ["Silicone","Padrão",15,5],["Faca","Padrão",8,2]
  ];
  const ins=db.prepare("INSERT INTO products(name,variant,qty,min_qty) VALUES(?,?,?,?)");
  const tx=db.transaction(rows=>rows.forEach(r=>ins.run(...r)));
  tx(seed);
}

function auth(req,res,next){
  if(!req.session.user) return res.status(401).json({error:"Não autenticado"});
  next();
}
function admin(req,res,next){
  if(!req.session.user || req.session.user.role!=="admin") return res.status(403).json({error:"Apenas o administrador pode executar esta ação"});
  next();
}

app.post("/api/login",(req,res)=>{
  const {username,password}=req.body||{};
  const u=db.prepare("SELECT * FROM users WHERE username=?").get(String(username||"").toLowerCase());
  if(!u || !u.active || !bcrypt.compareSync(String(password||""),u.password_hash))
    return res.status(401).json({error:"Usuário ou senha incorretos"});
  req.session.user={id:u.id,name:u.name,username:u.username,role:u.role};
  res.json({user:req.session.user});
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json({user:req.session.user||null}));

app.get("/api/products",auth,(req,res)=>{
  res.json(db.prepare("SELECT * FROM products ORDER BY name,variant").all());
});
app.post("/api/products",admin,(req,res)=>{
  const {name,variant="Padrão",qty=0,min_qty=0}=req.body||{};
  if(!name) return res.status(400).json({error:"Nome obrigatório"});
  const info=db.prepare("INSERT INTO products(name,variant,qty,min_qty) VALUES(?,?,?,?)")
    .run(name,variant,Number(qty)||0,Number(min_qty)||0);
  res.json(db.prepare("SELECT * FROM products WHERE id=?").get(info.lastInsertRowid));
});
app.put("/api/products/:id",admin,(req,res)=>{
  const {name,variant="Padrão",qty=0,min_qty=0}=req.body||{};
  db.prepare("UPDATE products SET name=?,variant=?,qty=?,min_qty=? WHERE id=?")
    .run(name,variant,Number(qty)||0,Number(min_qty)||0,req.params.id);
  res.json({ok:true});
});
app.delete("/api/products/:id",admin,(req,res)=>{
  db.prepare("DELETE FROM products WHERE id=?").run(req.params.id);
  res.json({ok:true});
});

app.post("/api/movements",admin,(req,res)=>{
  const {product_id,type,qty,ref="",note=""}=req.body||{};
  const n=Number(qty);
  if(!product_id || !["in","out"].includes(type) || !Number.isInteger(n) || n<=0)
    return res.status(400).json({error:"Dados de movimentação inválidos"});
  const p=db.prepare("SELECT * FROM products WHERE id=?").get(product_id);
  if(!p) return res.status(404).json({error:"Produto não encontrado"});
  if(type==="out" && n>p.qty) return res.status(400).json({error:"Estoque insuficiente"});
  const change=type==="in"?n:-n;
  const tx=db.transaction(()=>{
    db.prepare("UPDATE products SET qty=qty+? WHERE id=?").run(change,product_id);
    db.prepare("INSERT INTO movements(product_id,type,qty,ref,note,user_id) VALUES(?,?,?,?,?,?)")
      .run(product_id,type,n,ref,note,req.session.user.id);
  });
  tx();
  res.json({ok:true});
});
app.get("/api/movements",auth,(req,res)=>{
  res.json(db.prepare(`
    SELECT m.*,p.name product_name,p.variant,u.name user_name
    FROM movements m LEFT JOIN products p ON p.id=m.product_id
    LEFT JOIN users u ON u.id=m.user_id
    ORDER BY m.id DESC LIMIT 500
  `).all());
});
app.delete("/api/movements",admin,(req,res)=>{
  db.prepare("DELETE FROM movements").run();
  res.json({ok:true});
});

app.put("/api/me/password",auth,(req,res)=>{
  const {currentPassword,newPassword}=req.body||{};
  if(!currentPassword || !newPassword || String(newPassword).length < 6) return res.status(400).json({error:"A nova senha deve ter pelo menos 6 caracteres"});
  const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.session.user.id);
  if(!u || !bcrypt.compareSync(String(currentPassword),u.password_hash)) return res.status(400).json({error:"Senha atual incorreta"});
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(String(newPassword),12),u.id);
  res.json({ok:true});
});
app.get("/api/users",admin,(req,res)=>{
  res.json(db.prepare("SELECT id,name,username,role,active,created_at FROM users ORDER BY name").all());
});
app.post("/api/users",admin,(req,res)=>{
  const {name,username,password,role="user"}=req.body||{};
  if(!name||!username||!password||!["admin","user"].includes(role))
    return res.status(400).json({error:"Dados inválidos"});
  try {
    const hash=bcrypt.hashSync(password,12);
    const info=db.prepare("INSERT INTO users(name,username,password_hash,role) VALUES(?,?,?,?)")
      .run(name,String(username).toLowerCase(),hash,role);
    res.json({id:info.lastInsertRowid});
  } catch(e){res.status(400).json({error:"Usuário já existe"});}
});
app.put("/api/users/:id/password",admin,(req,res)=>{
  const {password}=req.body||{};
  if(!password || String(password).length < 6) return res.status(400).json({error:"Senha deve ter pelo menos 6 caracteres"});
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(String(password),12),req.params.id);
  res.json({ok:true});
});
app.put("/api/users/:id/status",admin,(req,res)=>{
  const id=Number(req.params.id), active=req.body?.active ? 1 : 0;
  if(id===req.session.user.id && !active) return res.status(400).json({error:"Você não pode bloquear seu próprio usuário"});
  const u=db.prepare("SELECT id,role FROM users WHERE id=?").get(id);
  if(!u) return res.status(404).json({error:"Usuário não encontrado"});
  if(u.role==="admin" && !active && db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1").get().c<=1) return res.status(400).json({error:"É necessário manter pelo menos um administrador ativo"});
  db.prepare("UPDATE users SET active=? WHERE id=?").run(active,id); res.json({ok:true});
});
app.delete("/api/users/:id",admin,(req,res)=>{
  const id=Number(req.params.id); if(id===req.session.user.id) return res.status(400).json({error:"Você não pode excluir seu próprio usuário"});
  const u=db.prepare("SELECT id,role FROM users WHERE id=?").get(id); if(!u) return res.status(404).json({error:"Usuário não encontrado"});
  if(u.role==="admin" && db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c<=1) return res.status(400).json({error:"É necessário manter pelo menos um administrador"});
  db.prepare("DELETE FROM users WHERE id=?").run(id); res.json({ok:true});
});


// Assistente de IA para consultar o estoque e interpretar comandos em linguagem natural.
// A chave da OpenAI fica somente no servidor (nunca no navegador).
let openai = null;
if (process.env.OPENAI_API_KEY) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post("/api/assistant", auth, async (req,res)=>{
  if(!openai) return res.status(503).json({error:"A IA ainda não foi configurada. Adicione OPENAI_API_KEY nas variáveis do servidor."});
  const message=String(req.body?.message||"").trim();
  if(!message) return res.status(400).json({error:"Comando vazio"});
  if(message.length>1000) return res.status(400).json({error:"Comando muito longo"});

  const products=db.prepare("SELECT id,name,variant,qty,min_qty FROM products WHERE active=1 ORDER BY name,variant").all();
  const context=products.map(p=>({id:p.id,name:p.name,variant:p.variant,qty:p.qty,min_qty:p.min_qty}));
  const isAdmin=req.session.user.role==="admin";
  const instructions=`Você é o assistente do Estoque Pro. Responda em português do Brasil, de forma curta e clara.\n\nUsuário atual: ${req.session.user.name} (${isAdmin?"administrador":"usuário comum"}).\n\nProdutos atuais (JSON): ${JSON.stringify(context)}\n\nRegras:\n- Você pode consultar estoque para qualquer usuário autenticado.\n- Somente administrador pode registrar entrada/saída e criar produto.\n- Nunca invente produto, quantidade ou ID.\n- Para movimentação, identifique o produto pelo nome/variação usando apenas a lista fornecida.\n- Se houver ambiguidade entre produtos, peça esclarecimento e não execute ação.\n- Uma saída não pode ultrapassar o estoque disponível.\n- Não altere estoque apenas porque o usuário perguntou; só proponha uma ação quando houver pedido explícito.\n- Se o usuário pedir algo fora do sistema de estoque, explique que pode ajudar com o estoque, usuários e movimentações.\n- A ação retornada será validada pelo servidor; nunca tente contornar permissões.`;

  try{
    const response=await openai.responses.create({
      model:process.env.OPENAI_MODEL||"gpt-5.6-luna",
      instructions,
      input:message,
      store:false,
      text:{format:{type:"json_schema",name:"estoque_assistant",strict:true,schema:{
        type:"object",additionalProperties:false,
        properties:{
          action:{type:"string",enum:["answer","move","create_product"]},
          reply:{type:"string"},
          product_id:{type:["integer","null"]},
          movement_type:{type:["string","null"],enum:["in","out",null]},
          quantity:{type:["integer","null"]},
          reference:{type:["string","null"]},
          note:{type:["string","null"]},
          product_name:{type:["string","null"]},
          variant:{type:["string","null"]}
        },required:["action","reply","product_id","movement_type","quantity","reference","note","product_name","variant"]
      }}}
    });
    const parsed=JSON.parse(response.output_text);
    if(parsed.action==="move"){
      if(!isAdmin) return res.json({action:"answer",reply:"Você pode consultar o estoque por voz, mas somente o administrador pode registrar entradas e saídas."});
      const p=parsed.product_id?db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(parsed.product_id):null;
      const n=Number(parsed.quantity);
      if(!p || !["in","out"].includes(parsed.movement_type) || !Number.isInteger(n) || n<=0)
        return res.json({action:"answer",reply:"Não consegui identificar com segurança o produto e a quantidade. Tente dizer, por exemplo: 'dar entrada de 100 botões de ferro'."});
      if(parsed.movement_type==="out" && n>p.qty) return res.json({action:"answer",reply:`Não posso registrar a saída de ${n} unidades de ${p.name} ${p.variant}, porque há apenas ${p.qty} no estoque.`});
    }
    if(parsed.action==="create_product" && !isAdmin) return res.json({action:"answer",reply:"Somente o administrador pode cadastrar produtos."});
    if(parsed.action==="create_product"){
      const name=String(parsed.product_name||"").trim(), variant=String(parsed.variant||"Padrão").trim();
      const n=Number(parsed.quantity||0);
      if(!name) return res.json({action:"answer",reply:"Diga o nome do produto que deseja cadastrar."});
      return res.json({action:"create_product",reply:parsed.reply||`Confirma o cadastro de ${name} — ${variant}?`,product_name:name,variant,quantity:Number.isInteger(n)&&n>=0?n:0});
    }
    if(parsed.action==="move"){
      return res.json({action:"move",reply:parsed.reply||"Confirme a movimentação.",product_id:parsed.product_id,movement_type:parsed.movement_type,quantity:parsed.quantity,reference:parsed.reference||"",note:parsed.note||""});
    }
    res.json({action:"answer",reply:parsed.reply||"Não encontrei uma resposta."});
  }catch(e){
    console.error("AI error",e);
    res.status(502).json({error:"Não foi possível consultar a IA agora."});
  }
});

app.post("/api/assistant/execute-move",admin,(req,res)=>{
  const {product_id,type,qty,ref="",note=""}=req.body||{};
  const n=Number(qty); if(!product_id||!["in","out"].includes(type)||!Number.isInteger(n)||n<=0) return res.status(400).json({error:"Movimentação inválida"});
  const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(product_id); if(!p) return res.status(404).json({error:"Produto não encontrado"});
  if(type==="out"&&n>p.qty) return res.status(400).json({error:"Estoque insuficiente"});
  const change=type==="in"?n:-n;
  const tx=db.transaction(()=>{db.prepare("UPDATE products SET qty=qty+? WHERE id=?").run(change,product_id);db.prepare("INSERT INTO movements(product_id,type,qty,ref,note,user_id) VALUES(?,?,?,?,?,?)").run(product_id,type,n,ref,note,req.session.user.id)}); tx();
  res.json({ok:true});
});

app.post("/api/assistant/execute-product",admin,(req,res)=>{
  const {name,variant="Padrão",qty=0,min_qty=0}=req.body||{};
  if(!name) return res.status(400).json({error:"Nome obrigatório"});
  const info=db.prepare("INSERT INTO products(name,variant,qty,min_qty) VALUES(?,?,?,?)").run(String(name).trim(),String(variant).trim()||"Padrão",Number(qty)||0,Number(min_qty)||0);
  res.json(db.prepare("SELECT * FROM products WHERE id=?").get(info.lastInsertRowid));
});

app.listen(PORT,()=>console.log(`Estoque Pro rodando em http://localhost:${PORT}`));
