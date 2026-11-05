import os, re, uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile
import bcrypt, jwt
from dotenv import load_dotenv

from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

BASE = Path(__file__).resolve().parent.parent
load_dotenv(BASE / ".env")
DB_URL, SECRET = os.environ["DATABASE_URL"], os.environ["JWT_SECRET"]
ADMIN_USER, ADMIN_PASS = os.getenv("ADMIN_USERNAME", "admin"), os.getenv("ADMIN_PASSWORD", "")

def strong(p):
    return len(p) >= 12 and all(re.search(x, p) for x in (r"[a-z]", r"[A-Z]", r"\d", r"[^\w\s]"))

pool = ConnectionPool(DB_URL, kwargs={"row_factory": dict_row, "prepare_threshold": None}, min_size=1, max_size=3, open=False)
SCHEMA = """
CREATE TABLE IF NOT EXISTS files(name VARCHAR(60) PRIMARY KEY, content_type VARCHAR(40) NOT NULL, data BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS admins(id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS items(
  id SERIAL PRIMARY KEY, kind VARCHAR(10) NOT NULL CHECK (kind IN ('product','project')),
  category VARCHAR(80), title VARCHAR(150) NOT NULL, description TEXT, details TEXT, location VARCHAR(120),
  published BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS media(
  id SERIAL PRIMARY KEY, item_id INT REFERENCES items(id) ON DELETE CASCADE,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('image','document')), title VARCHAR(150), file_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_media_item ON media(item_id);
CREATE TABLE IF NOT EXISTS enquiries(
  id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, phone VARCHAR(20) NOT NULL, message TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS login_attempts(id SERIAL PRIMARY KEY, ip VARCHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS settings(key VARCHAR(40) PRIMARY KEY, value TEXT);
"""
DEFAULTS = {"phone": "+91 00000 00000", "whatsapp": "910000000000", "email": "info@example.com",
            "address": "Add your workshop address, Ahmedabad, Gujarat", "hours": "Mon-Sat, 9:30 am - 7:30 pm"}
SEED = [("product", "Wardrobes", "Sliding wardrobe", "Floor-to-ceiling storage with soft-close sliding doors and custom internal fittings."),
        ("product", "Modular Kitchens", "L-shaped modular kitchen", "Moisture-resistant cabinets, quality hardware and counter-top options."),
        ("product", "Beds", "Storage bed with headboard", "Hydraulic storage, upholstered headboard and matching side tables."),
        ("product", "Sofas & Seating", "Custom sofa set", "Made to your room size with your choice of fabric and foam density."),
        ("product", "TV Units & Panels", "Wall-mounted TV unit", "Fluted panels, hidden wiring and back-lit niches."),
        ("product", "Office Furniture", "Workstation and cabin set", "Desks, storage and meeting tables for teams of any size.")]

def q(sql, params=None, one=False):
    with pool.connection() as c:
        cur = c.execute(sql, params or ())
        if cur.description is None: return None
        return cur.fetchone() if one else cur.fetchall()

@asynccontextmanager
async def lifespan(app):
    if len(SECRET) < 32: raise RuntimeError("JWT_SECRET must be at least 32 characters")
    pool.open(); q(SCHEMA)
    if not strong(ADMIN_PASS):
        print("WARNING: ADMIN_PASSWORD is weak or missing. Admin account was not changed.")
    else:
        row = q("SELECT password_hash FROM admins WHERE username=%s", (ADMIN_USER,), one=True)
        if not row:
            q("INSERT INTO admins(username,password_hash) VALUES(%s,%s)",
              (ADMIN_USER, bcrypt.hashpw(ADMIN_PASS.encode(), bcrypt.gensalt()).decode()))
        elif not bcrypt.checkpw(ADMIN_PASS.encode(), row["password_hash"].encode()):
            q("UPDATE admins SET password_hash=%s WHERE username=%s",
              (bcrypt.hashpw(ADMIN_PASS.encode(), bcrypt.gensalt()).decode(), ADMIN_USER))
    for k, v in DEFAULTS.items(): q("INSERT INTO settings VALUES(%s,%s) ON CONFLICT DO NOTHING", (k, v))
    if not q("SELECT 1 FROM items", one=True):
        for s in SEED: q("INSERT INTO items(kind,category,title,description) VALUES(%s,%s,%s,%s)", s)
    yield
    pool.close()

app = FastAPI(title="Shree Gurukrupa Furniture API", lifespan=lifespan, docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")

# ---------- helpers ----------
MAGIC = {".jpg": b"\xff\xd8", ".png": b"\x89PNG", ".webp": b"RIFF", ".pdf": b"%PDF"}
TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf"}

async def save_file(f: UploadFile, want: str) -> str:
    ext = TYPES.get(f.content_type or "")
    if not ext or (want == "image") == (ext == ".pdf"): raise HTTPException(400, f"Upload a valid {want} file")
    data = await f.read()
    if len(data) > 4_000_000: raise HTTPException(400, "File is too large (max 4 MB)")
    if not data.startswith(MAGIC[ext]): raise HTTPException(400, "File content does not match its type")
    name = uuid.uuid4().hex + ext
    q("INSERT INTO files VALUES(%s,%s,%s)", (name, f.content_type, data))
    return name

def drop_files(paths):
    if paths: q("DELETE FROM files WHERE name = ANY(%s)", (list(paths),))

def attach_images(rows):
    ids = [r["id"] for r in rows]
    media = q("SELECT id,item_id,file_path FROM media WHERE kind='image' AND item_id = ANY(%s) ORDER BY id", (ids,)) if ids else []
    for r in rows:
        r["images"] = [{"id": m["id"], "url": "/uploads/" + m["file_path"]} for m in media if m["item_id"] == r["id"]]
    return rows

def admin(authorization: str = Header("")):
    try: jwt.decode(authorization[7:], SECRET, algorithms=["HS256"])
    except Exception: raise HTTPException(401, "Please log in again")

# ---------- public API ----------
@app.get("/api/settings")
def get_settings():
    return {r["key"]: r["value"] for r in q("SELECT * FROM settings")}

@app.get("/api/items")
def public_items(kind: str | None = None):
    rows = q("SELECT * FROM items WHERE published AND (%s::text IS NULL OR kind=%s) ORDER BY id DESC", (kind, kind))
    return attach_images(rows)

@app.get("/api/documents")
def public_documents():
    return [{"id": r["id"], "title": r["title"], "url": "/uploads/" + r["file_path"]}
            for r in q("SELECT * FROM media WHERE kind='document' ORDER BY id DESC")]

class Enquiry(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    phone: str = Field(pattern=r"^[+\d\s-]{7,15}$")
    message: str = Field(default="", max_length=1000)

@app.post("/api/enquiries", status_code=201)
def new_enquiry(e: Enquiry):
    q("INSERT INTO enquiries(name,phone,message) VALUES(%s,%s,%s)", (e.name.strip(), e.phone, e.message.strip()))
    return {"ok": True}

# ---------- admin API ----------
class Login(BaseModel):
    username: str
    password: str

@app.post("/api/admin/login")
def login(body: Login, request: Request):
    ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
          or (request.client.host if request.client else "unknown"))[:64]
    q("DELETE FROM login_attempts WHERE created_at < now() - interval '1 day'")
    n = q("SELECT count(*) AS n FROM login_attempts WHERE ip=%s AND created_at > now() - interval '15 minutes'", (ip,), one=True)["n"]
    if n >= 5: raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
    row = q("SELECT * FROM admins WHERE username=%s", (body.username,), one=True)
    if not row or not bcrypt.checkpw(body.password.encode(), row["password_hash"].encode()):
        q("INSERT INTO login_attempts(ip) VALUES(%s)", (ip,))
        raise HTTPException(401, "Wrong username or password")
    exp = datetime.now(timezone.utc) + timedelta(hours=4)
    return {"token": jwt.encode({"sub": body.username, "exp": exp}, SECRET, algorithm="HS256")}

@app.get("/api/admin/items", dependencies=[Depends(admin)])
def admin_items():
    return attach_images(q("SELECT * FROM items ORDER BY id DESC"))

@app.post("/api/admin/items", dependencies=[Depends(admin)], status_code=201)
async def add_item(kind: str = Form(), category: str = Form(""), title: str = Form(), description: str = Form(""),
                   details: str = Form(""), location: str = Form(""), files: list[UploadFile] = File(default=[])):
    if kind not in ("product", "project") or not title.strip(): raise HTTPException(400, "Kind and title are required")
    names = [await save_file(f, "image") for f in files if f.filename]
    row = q("INSERT INTO items(kind,category,title,description,details,location) VALUES(%s,%s,%s,%s,%s,%s) RETURNING id",
            (kind, category, title.strip(), description, details, location), one=True)
    for n in names: q("INSERT INTO media(item_id,kind,file_path) VALUES(%s,'image',%s)", (row["id"], n))
    return {"id": row["id"]}

@app.put("/api/admin/items/{item_id}", dependencies=[Depends(admin)])
async def edit_item(item_id: int, category: str = Form(""), title: str = Form(), description: str = Form(""),
                    details: str = Form(""), location: str = Form(""), published: bool = Form(True),
                    files: list[UploadFile] = File(default=[])):
    names = [await save_file(f, "image") for f in files if f.filename]
    q("UPDATE items SET category=%s,title=%s,description=%s,details=%s,location=%s,published=%s WHERE id=%s",
      (category, title.strip(), description, details, location, published, item_id))
    for n in names: q("INSERT INTO media(item_id,kind,file_path) VALUES(%s,'image',%s)", (item_id, n))
    return {"ok": True}

@app.delete("/api/admin/items/{item_id}", dependencies=[Depends(admin)])
def del_item(item_id: int):
    files = [m["file_path"] for m in q("SELECT file_path FROM media WHERE item_id=%s", (item_id,))]
    q("DELETE FROM items WHERE id=%s", (item_id,)); drop_files(files); return {"ok": True}

@app.delete("/api/admin/media/{media_id}", dependencies=[Depends(admin)])
def del_media(media_id: int):
    row = q("DELETE FROM media WHERE id=%s RETURNING file_path", (media_id,), one=True)
    if row: drop_files([row["file_path"]])
    return {"ok": True}

@app.post("/api/admin/documents", dependencies=[Depends(admin)], status_code=201)
async def add_doc(title: str = Form(), file: UploadFile = File()):
    name = await save_file(file, "document")
    q("INSERT INTO media(kind,title,file_path) VALUES('document',%s,%s)", (title.strip(), name)); return {"ok": True}

@app.get("/api/admin/enquiries", dependencies=[Depends(admin)])
def enquiries():
    return q("SELECT * FROM enquiries ORDER BY id DESC")

@app.patch("/api/admin/enquiries/{eid}", dependencies=[Depends(admin)])
def enquiry_status(eid: int, status: str):
    if status not in ("new", "contacted", "closed"): raise HTTPException(400, "Invalid status")
    q("UPDATE enquiries SET status=%s WHERE id=%s", (status, eid)); return {"ok": True}

@app.put("/api/admin/settings", dependencies=[Depends(admin)])
def put_settings(data: dict[str, str]):
    for k, v in data.items():
        if k in DEFAULTS: q("INSERT INTO settings VALUES(%s,%s) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", (k, v[:300]))
    return {"ok": True}

@app.get("/uploads/{name}")
def get_upload(name: str):
    row = q("SELECT content_type,data FROM files WHERE name=%s", (name,), one=True) if re.fullmatch(r"[a-f0-9]{32}\.(jpg|png|webp|pdf)", name) else None
    if not row: raise HTTPException(404, "Not found")
    return Response(bytes(row["data"]), media_type=row["content_type"], headers={"Cache-Control": "public, max-age=31536000, immutable"})

if not os.getenv("VERCEL"):  # on Vercel, the public/ folder is served by the platform itself
    app.mount("/", StaticFiles(directory=BASE / "public", html=True), name="public")