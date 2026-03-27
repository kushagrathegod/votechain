// frontend/server.js — Express server for the Ethereum Voting frontend
// Uses PostgreSQL for voter authentication — no hardcoded credentials
const express = require("express");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── CORS and CSP — allow dashboard access and permit 'eval' for dev/libraries ────────
app.use((req, res, next) => {
    const allowed = ['http://localhost:5173', 'http://127.0.0.1:5173'];
    const origin = req.headers.origin;
    if (allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // ── CSP — allows face-api.js (eval), Tailwind (inline), and CDNs ──────────
    // Note: 'unsafe-eval' is needed for face-api.js/TensorFlow.js and Vite HMR
    res.setHeader('Content-Security-Policy', 
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://fonts.googleapis.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.tailwindcss.com; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data: blob:; " +
        "connect-src 'self' http://localhost:5173 http://127.0.0.1:5173 http://127.0.0.1:8545 ws://localhost:5173 http://localhost:8080 http://localhost:8001 http://localhost:8002; " +
        "frame-src 'self';"
    );

    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});


// Redirect logs to file for debugging
const logFile = fs.createWriteStream(path.join(__dirname, 'server.log'), { flags: 'a' });
const logStdout = process.stdout;
console.log = function () {
    logFile.write(new Date().toISOString() + ' ' + Array.from(arguments).join(' ') + '\n');
    logStdout.write(Array.from(arguments).join(' ') + '\n');
};
console.error = console.log;
console.warn = console.log;

// ── PostgreSQL connection pool ─────────────────────────────────────────────
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },  // required for Supabase
    max: 10,
    idleTimeoutMillis: 30000,
});

pool.on("error", (err) => console.error("PostgreSQL pool error:", err));

// Test DB connection at startup
pool.query("SELECT 1").then(() => {
    console.log("✅  PostgreSQL connected");
}).catch(err => {
    console.error("❌  PostgreSQL connection failed:", err.message);
    console.error("    Make sure DATABASE_URL is set in .env and the DB is reachable.");
});

// ── Static assets ──────────────────────────────────────────────────────────
app.use("/src", express.static(path.join(__dirname, "src")));
app.use("/models", express.static(path.join(__dirname, "public/models")));
app.use("/public", express.static(path.join(__dirname, "public")));

// ── JWT auth middleware ────────────────────────────────────────────────────
const JWT_SECRET = process.env.SECRET_KEY;
if (!JWT_SECRET) {
    console.error("❌  SECRET_KEY not set in .env — JWT will fail!");
}

const authorizeUser = (req, res, next) => {
    // Prefer Authorization header over query params (security best practice)
    let token = req.headers.authorization?.split("Bearer ")[1];

    // Legacy fallback for query param (deprecate in future)
    if (!token && req.query.Authorization) {
        token = req.query.Authorization.split("Bearer ")[1];
    }

    if (!token) {
        // Return JSON for API routes, redirect for HTML routes
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: "Authentication required" });
        }
        return res.redirect("/");
    }

    try {
        req.user = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
        next();
    } catch (err) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: "Invalid or expired token" });
        }
        return res.redirect("/");
    }
};

// ── HTML Routes ────────────────────────────────────────────────────────────
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "src/login.html")));
app.get("/register", (_req, res) => res.sendFile(path.join(__dirname, "src/register.html")));
app.get("/vote", authorizeUser, (_req, res) => res.sendFile(path.join(__dirname, "src/vote.html")));
app.get("/admin", authorizeUser, (req, res) => {
    if (req.user.role !== "admin") return res.status(403).sendFile(path.join(__dirname, "src/login.html"));
    // Redirect admin to the modern React Dashboard
    res.redirect("http://localhost:5173");
});
app.get("/favicon.ico", (_req, res) => res.status(204).end());

// ── Contract JSON ──────────────────────────────────────────────────────────
app.get("/contract.json", (_req, res) => {
    const contractPath = path.join(__dirname, "src/contract.json");
    if (fs.existsSync(contractPath)) {
        res.sendFile(contractPath);
    } else {
        res.status(404).json({ error: "Contract not deployed yet. Run: npm run deploy:local" });
    }
});

// ── POST /login — authenticate against PostgreSQL (secure POST method) ─────
// NOTE: GET /login with credentials in query string removed for security
// All clients should use POST /api/login with credentials in request body
app.post("/login", async (req, res) => {
    const { voter_id, password } = req.body;

    if (!voter_id || !password) {
        return res.status(400).json({ message: "voter_id and password are required" });
    }

    try {
        const { rows } = await pool.query(
            "SELECT voter_id, hashed_password, role, full_name, is_active, booth_id FROM voters WHERE voter_id = $1",
            [voter_id.trim()]
        );

        if (rows.length === 0) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const voter = rows[0];
        const valid = await bcrypt.compare(password, voter.hashed_password);
        if (!valid) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const token = jwt.sign(
            { id: voter.voter_id, role: voter.role, name: voter.full_name, booth: voter.booth_id },
            JWT_SECRET,
            { expiresIn: '2h' }
        );
        res.json({ token, role: voter.role, full_name: voter.full_name });
    } catch (err) {
        console.error("Login error:", err);
        return res.status(500).json({ message: "Internal server error" });
    }
});

app.get("/profile", authorizeUser, (_req, res) => res.sendFile(path.join(__dirname, "src/profile.html")));

// ────────────────────────────────────────────────────────────────────────
// AUTHENTICATION
// ────────────────────────────────────────────────────────────────────────

// Redundant /api/me removed to use database-backed version below

app.get('/api/my-receipts', authorizeUser, async (req, res) => {
    try {
        const { rows } = await pool.query(
            "SELECT details, created_at FROM audit_log WHERE action = 'vote_cast' AND voter_id = $1 ORDER BY created_at DESC",
            [req.user.id || req.user.voter_id]
        );
        
        // Parse "Election: X, Tx: Y" strings into json
        const receipts = rows.map(r => {
            const match = r.details.match(/Election:\s*([^,]+),\s*Tx:\s*([^ ]+)/i);
            return {
                election_id: match ? match[1] : 'Unknown',
                tx_hash: match ? match[2] : r.details,
                created_at: r.created_at
            };
        });
        
        res.json(receipts);
    } catch (e) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/login', async (req, res) => {
    const { voter_id, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM voters WHERE voter_id = $1', [voter_id]);

        // Log attempt
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        if (result.rows.length === 0) {
            await pool.query('INSERT INTO audit_log (voter_id, action, ip_address) VALUES ($1, $2, $3)', [voter_id, 'login_failed', ip]);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];

        if (user.status === 'pending') {
            await pool.query('INSERT INTO audit_log (voter_id, action, ip_address) VALUES ($1, $2, $3)', [voter_id, 'login_failed_pending', ip]);
            return res.status(403).json({ error: 'Account pending admin approval', pending: true });
        }

        const match = await bcrypt.compare(password, user.hashed_password);
        if (!match) {
            await pool.query('INSERT INTO audit_log (voter_id, action, ip_address) VALUES ($1, $2, $3)', [voter_id, 'login_failed', ip]);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        await pool.query('INSERT INTO audit_log (voter_id, action, ip_address) VALUES ($1, $2, $3)', [voter_id, 'login_success', ip]);

        const token = jwt.sign(
            { id: user.voter_id, role: user.role, name: user.full_name, booth: user.booth_id },
            JWT_SECRET,
            { expiresIn: '2h' }
        );
        res.json({ token, role: user.role, name: user.full_name });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/register', async (req, res) => {
    const { voter_id, password, full_name, email, booth_id, face_embedding } = req.body;
    try {
        // Validate inputs
        if (!voter_id || !password || !full_name || !face_embedding) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Hash password with consistent salt rounds
        const hashedPassword = await bcrypt.hash(password, 12);

        // Insert as pending
        await pool.query(`
            INSERT INTO voters (voter_id, hashed_password, role, full_name, email, booth_id, status, face_embedding)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
            voter_id,
            hashedPassword,
            'voter',
            full_name,
            email || null,
            booth_id || 'DEFAULT',
            'pending',
            JSON.stringify(face_embedding)
        ]);

        res.status(201).json({ message: 'Registration successful. Pending admin approval.' });
    } catch (e) {
        console.error(e);
        if (e.code === '23505') { // unique violation
            return res.status(409).json({ error: 'Voter ID or Email already exists' });
        }
        res.status(500).json({ error: 'Registration failed' });
    }
});

// ── Utility: Euclidean Distance for Face Embeddings ──────────────────────
function calculateEuclideanDistance(desc1, desc2) {
    if (desc1.length !== desc2.length) return 1.0;
    let sum = 0;
    for (let i = 0; i < desc1.length; i++) {
        sum += Math.pow(desc1[i] - desc2[i], 2);
    }
    return Math.sqrt(sum);
}

// ── Server-Side Blockchain Transaction Setup ─────────────────────────────
const { ethers } = require("ethers");
let lastDeployedAddress = null;

async function syncBlockchain() {
    try {
        const contractPath = path.join(__dirname, "src/contract.json");
        if (!fs.existsSync(contractPath)) return;

        const contractData = JSON.parse(fs.readFileSync(contractPath, "utf8"));
        
        // If contract is same, skip re-init
        if (contractData.address === lastDeployedAddress && contract) return;

        const rpcUrl = process.env.ETH_RPC_URL || "http://127.0.0.1:8545";
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const privateKey = process.env.MASTER_WALLET_PRIVATE_KEY;

        if (!privateKey) {
            console.error("❌  MASTER_WALLET_PRIVATE_KEY missing from .env");
            return;
        }

        masterWallet = new ethers.Wallet(privateKey, provider);
        contract = new ethers.Contract(contractData.address, contractData.abi, masterWallet);
        lastDeployedAddress = contractData.address;

        console.log("🔄  Blockchain Contract Synced:", lastDeployedAddress);
    } catch (e) {
        console.error("❌  Failed to sync blockchain:", e.message);
    }
}

// Initial sync
syncBlockchain();

// ── POST /api/cast-vote — Biometric Vote Casting ─────────────────────────
app.post("/api/cast-vote", authorizeUser, async (req, res) => {
    const { electionId, candidateId, face_embedding } = req.body;
    const voterId = req.user.id || req.user.voter_id;

    // Ensure we are using the latest deployment
    await syncBlockchain();
    if (!contract || !masterWallet) return res.status(500).json({ error: "Server blockchain connection not ready" });
    if (!electionId || !candidateId || !face_embedding) return res.status(400).json({ error: "Missing required voting parameters." });

    try {
        // 1. Fetch voter from DB to get their stored biometric profile
        const { rows } = await pool.query(
            "SELECT face_embedding, status FROM voters WHERE voter_id = $1",
            [voterId]
        );

        if (rows.length === 0) return res.status(404).json({ error: "Voter not found in database." });

        const voter = rows[0];

        if (voter.status !== 'approved') return res.status(403).json({ error: "Voter account is not approved by administrator." });
        if (!voter.face_embedding) return res.status(400).json({ error: "No biometric profile found on file. Please re-register." });

        // 2. Perform Biometric Verification (Face match)
        let storedEmbedding;
        try {
            storedEmbedding = Array.isArray(voter.face_embedding) ? voter.face_embedding : JSON.parse(voter.face_embedding);
        } catch (e) { return res.status(500).json({ error: "Stored biometric data is corrupted." }); }

        const distance = calculateEuclideanDistance(face_embedding, storedEmbedding);

        // Standard threshold is 0.6 (Face-api.js default for ssdMobilenetv1)
        if (distance > 0.6) {
            console.warn(`[BIOMETRIC REJECT] ID: ${voterId}, Distance: ${distance.toFixed(3)}`);
            await pool.query('INSERT INTO audit_log (voter_id, action, ip_address, details) VALUES ($1, $2, $3, $4)',
                [voterId, 'biometric_failure', req.ip || req.socket.remoteAddress, `Distance: ${distance}`]);
            return res.status(401).json({ error: "Biometric face verification failed. Identity did not match." });
        }

        // 3. Generate a voter hash for the blockchain to track double voting securely
        const voterHash = ethers.id(voterId + electionId + process.env.SECRET_KEY);

        console.log(`[VOTING] Attempting castVote: Election=${electionId}, VoterId=${voterId}, Candidate=${candidateId}, Hash=${voterHash}`);

        // 4. Send transaction to blockchain via Master Wallet
        const tx = await contract.castVote(electionId, voterHash, candidateId);

        console.log(`[VOTE SUBMITTED] Hash: ${tx.hash}`);
        const receipt = await tx.wait(); // Wait for confirmation

        try {
            await pool.query('INSERT INTO audit_log (voter_id, action, ip_address, details) VALUES ($1, $2, $3, $4)',
                [voterId, 'vote_cast', req.ip || req.socket.remoteAddress, `Election: ${electionId}, Tx: ${tx.hash}`]);
        } catch (logErr) {
            console.error("[LOG ERROR] Failed to write audit log:", logErr.message);
        }

        res.json({ success: true, transactionHash: tx.hash });
    } catch (e) {
        console.error("Blockchain Vote Error Details:", e);

        // Ethers v6 error handling
        const errorMessage = e.message || "";
        const revertReason = e.reason || (e.info && e.info.error && e.info.error.message) || "";

        if (errorMessage.includes("Already voted") || revertReason.includes("Already voted")) {
            console.warn(`[VOTE REJECT] Voter ${voterId} already voted.`);
            return res.status(403).json({ error: "You have already cast a vote in this election." });
        }

        if (errorMessage.includes("Invalid candidate") || revertReason.includes("Invalid candidate")) {
            return res.status(400).json({ error: "Invalid candidate selected." });
        }

        res.status(500).json({
            error: "Failed to cast vote on blockchain.",
            details: revertReason || errorMessage
        });
    }
});

// ── GET /api/me — return info about the current logged-in voter ───────────
app.get("/api/me", authorizeUser, async (req, res) => {
    try {
        const { rows } = await pool.query(
            "SELECT voter_id, full_name, email, role, booth_id, created_at FROM voters WHERE voter_id = $1",
            [req.user.id || req.user.voter_id] // Handle both payload versions
        );
        if (rows.length === 0) return res.status(404).json({ message: "Voter not found" });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ message: "Database error" });
    }
});

// ── GET /api/voters — admin only: list all voters ─────────────────────────
app.get("/api/voters", authorizeUser, async (req, res) => {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
    try {
        const { rows } = await pool.query(
            "SELECT voter_id, full_name, email, role, booth_id, is_active, status, created_at FROM voters ORDER BY created_at DESC"
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: "Database error" });
    }
});

// ── POST /api/voters — admin only: create a new voter ────────────────────
app.post("/api/voters", authorizeUser, async (req, res) => {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
    const { voter_id, password, full_name, email, booth_id, role = "voter" } = req.body;
    if (!voter_id || !password) return res.status(400).json({ message: "voter_id and password are required" });
    try {
        const hashed = await bcrypt.hash(password, 12);
        const { rows } = await pool.query(
            `INSERT INTO voters (voter_id, hashed_password, role, full_name, email, booth_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'approved') RETURNING voter_id, role, full_name, email, booth_id`,
            [voter_id, hashed, role, full_name || null, email || null, booth_id || null]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === "23505") return res.status(409).json({ message: "voter_id or email already exists" });
        res.status(500).json({ message: "Database error" });
    }
});

// ── POST /api/voters/bulk-csv — admin only: import voters from CSV ────────
// CSV format (with header row):
//   voter_id,full_name,password,email,booth_id
app.post("/api/voters/bulk-csv", authorizeUser, async (req, res) => {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
    const { csv } = req.body;
    if (!csv || typeof csv !== "string") return res.status(400).json({ message: "csv field required" });

    const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return res.status(400).json({ message: "CSV must have a header row and at least one data row" });

    // Robust header parsing: Strip BOM, trim whitespace, and lowercase
    const headerLine = lines[0].replace(/^\uFEFF/, '').toLowerCase();
    const header = headerLine.split(",").map(h => h.trim());
    
    const required = ["voter_id", "full_name", "password"];
    const missing = required.filter(f => !header.includes(f));
    if (missing.length) return res.status(400).json({ message: `Missing CSV columns: ${missing.join(", ")}` });

    const idxOf = col => header.indexOf(col);
    const results = { imported: 0, skipped: 0, errors: [] };

    console.log(`[BULK VOTERS] Starting import of ${lines.length - 1} rows...`);

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map(c => c.trim());
        const voter_id   = cols[idxOf("voter_id")]   || "";
        const full_name  = cols[idxOf("full_name")]  || "";
        const password   = cols[idxOf("password")]   || "";
        const email      = idxOf("email")      >= 0 ? cols[idxOf("email")]      || null : null;
        const booth_id   = idxOf("booth_id")   >= 0 ? cols[idxOf("booth_id")]   || null : "DEFAULT";

        if (!voter_id || !password) { 
            results.skipped++; 
            results.errors.push(`Row ${i + 1}: voter_id and password required`); 
            continue; 
        }

        try {
            const hashed = await bcrypt.hash(password, 12);
            await pool.query(
                `INSERT INTO voters (voter_id, hashed_password, role, full_name, email, booth_id, status)
                 VALUES ($1, $2, 'voter', $3, $4, $5, 'approved')
                 ON CONFLICT (voter_id) DO UPDATE
                   SET hashed_password = EXCLUDED.hashed_password,
                       full_name       = EXCLUDED.full_name,
                       email           = EXCLUDED.email,
                       booth_id        = EXCLUDED.booth_id,
                       status          = 'approved'`,
                [voter_id, hashed, full_name || null, email, booth_id]
            );
            results.imported++;
        } catch (err) {
            results.skipped++;
            results.errors.push(`Row ${i + 1} (${voter_id}): ${err.message}`);
            console.error(`[BULK VOTERS] Error at row ${i+1}:`, err.message);
        }
    }

    console.log(`[BULK VOTERS] Finished: ${results.imported} imported, ${results.skipped} skipped.`);
    res.json({ success: true, ...results });
});

// ── POST /api/candidates/bulk-csv — admin only: import candidates via CSV ─
// CSV format (with header row):
//   name,party
app.post("/api/candidates/bulk-csv", authorizeUser, async (req, res) => {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
    const { csv, electionId } = req.body;
    if (!csv || !electionId) return res.status(400).json({ message: "csv and electionId fields required" });

    // Always check for latest contract deployment
    await syncBlockchain();
    if (!contract || !masterWallet) return res.status(503).json({ message: "Blockchain not ready — restart server after deployment" });

    const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return res.status(400).json({ message: "CSV must have a header row and at least one data row" });

    // Robust header parsing: Strip BOM, trim whitespace, and lowercase
    const headerLine = lines[0].replace(/^\uFEFF/, '').toLowerCase();
    const header = headerLine.split(",").map(h => h.trim());
    
    if (!header.includes("name") || !header.includes("party")) {
        return res.status(400).json({ message: "CSV must have 'name' and 'party' columns" });
    }

    const idxName  = header.indexOf("name");
    const idxParty = header.indexOf("party");
    const results  = { imported: 0, skipped: 0, errors: [] };

    console.log(`[BULK CANDIDATES] Starting import for election ${electionId}...`);

    // Fetch nonce once for the start of the batch
    let nonce = await masterWallet.provider.getTransactionCount(masterWallet.address, "pending");

    for (let i = 1; i < lines.length; i++) {
        const rowContent = lines[i];
        const cols = rowContent.split(",").map(c => c.trim());
        const name  = cols[idxName]  || "";
        const party = cols[idxParty] || "";
        
        if (!name || !party) { 
            results.skipped++; 
            results.errors.push(`Row ${i + 1}: name and party required`); 
            continue; 
        }

        try {
            console.log(`[BULK CANDIDATES] Row ${i+1}: Adding ${name} (${party})...`);
            // We use 'pending' nonce and manually increment to avoid issues on fast chains
            // await tx.wait() ensures we don't spam too fast but manual nonce keeps it sequential
            const tx = await contract.addCandidate(electionId, name, party, { nonce: nonce++ });
            await tx.wait();
            
            console.log(`[BULK CANDIDATES] Row ${i+1}: Success (Tx: ${tx.hash})`);
            results.imported++;
        } catch (err) {
            results.skipped++;
            const simpleErr = (err.reason || err.message || "Unknown error").split("(")[0].trim();
            results.errors.push(`Row ${i + 1} (${name}): ${simpleErr}`);
            console.error(`[BULK CANDIDATES] Row ${i+1} Error:`, simpleErr);
        }
    }

    console.log(`[BULK CANDIDATES] Finished: ${results.imported} imported, ${results.skipped} skipped.`);
    res.json({ success: true, ...results });
});

// ── POST /api/party-logo — admin only: upload party logo image ───────────
app.post("/api/party-logo", authorizeUser, (req, res) => {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
    const { partySlug, imageBase64 } = req.body;
    if (!partySlug || !imageBase64) return res.status(400).json({ message: "partySlug and imageBase64 required" });

    try {
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const dir = path.join(__dirname, "public/logos");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        const filePath = path.join(dir, `${partySlug.toLowerCase().replace(/[^a-z0-9]/g, '')}.png`);
        fs.writeFileSync(filePath, base64Data, 'base64');
        res.json({ success: true, message: "Logo uploaded" });
    } catch (err) {
        console.error("Logo upload error:", err);
        res.status(500).json({ message: "Failed to save logo" });
    }
});

// ── DELETE /api/voters/:id — admin only ─────────────────────────────
app.delete("/api/voters/:id", authorizeUser, async (req, res) => {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
    try {
        if (req.params.id === "admin") return res.status(400).json({ message: "Cannot delete the main admin" });
        await pool.query("DELETE FROM voters WHERE voter_id = $1", [req.params.id]);
        res.json({ success: true, message: "Voter deleted" });
    } catch (e) { res.status(500).json({ error: 'Database error' }); }
});

// Approve pending voter
app.put('/api/voters/:id/approve', authorizeUser, async (req, res) => {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
    try {
        const result = await pool.query('UPDATE voters SET status = $1 WHERE voter_id = $2 RETURNING *', ['approved', req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Voter not found' });
        res.json({ success: true, voter_id: req.params.id, status: 'approved' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to approve voter' });
    }
});

// ── GET /api/audit-log — admin only ──────────────────────────────────────
app.get("/api/audit-log", authorizeUser, async (req, res) => {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const { rows } = await pool.query(
            "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1",
            [limit]
        );
        res.json(rows);
    } catch (err) {
        console.error("Audit log error:", err);
        res.status(500).json({ message: "Database error" });
    }
});

// ── GET /api/booths/stats — admin only ────────────────────────────────────
app.get("/api/booths/stats", authorizeUser, async (req, res) => {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
    const BOOTHS = ['BOOTH_001', 'BOOTH_002', 'BOOTH_003', 'BOOTH_004', 'BOOTH_005', 'BOOTH_006'];
    try {
        const { rows } = await pool.query(
            `SELECT booth_id, COUNT(*) as total,
             SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved,
             SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending
             FROM voters WHERE role != 'admin' AND booth_id = ANY($1)
             GROUP BY booth_id`,
            [BOOTHS]
        );
        // Build a full map so booths with 0 voters still appear
        const statsMap = {};
        for (const b of BOOTHS) statsMap[b] = { booth_id: b, total: 0, approved: 0, pending: 0 };
        for (const r of rows) statsMap[r.booth_id] = { ...statsMap[r.booth_id], ...r, total: Number(r.total), approved: Number(r.approved), pending: Number(r.pending) };
        res.json(Object.values(statsMap));
    } catch (err) {
        console.error("Booth stats error:", err);
        res.status(500).json({ message: "Database error" });
    }
});

// ── GET /api/receipt/:tx_hash — Fetch blockchain transaction ──────────────
app.get("/api/receipt/:tx_hash", async (req, res) => {
    const { tx_hash } = req.params;
    
    try {
        await syncBlockchain();
        if (!contract || !masterWallet) {
            return res.status(503).json({ error: "Blockchain service not ready" });
        }

        // Fetch transaction from blockchain using ethers
        const provider = masterWallet.provider;
        if (!provider) {
            return res.status(503).json({ error: "Provider not available" });
        }

        const tx = await provider.getTransaction(tx_hash);
        if (!tx) {
            return res.status(404).json({ error: "Transaction not found" });
        }

        const receipt = await provider.getTransactionReceipt(tx_hash);
        
        // Hash the voter ID from transaction
        const voterHash = ethers.id(tx_hash + process.env.SECRET_KEY);

        return res.json({
            tx_hash: tx.hash,
            block_number: receipt?.blockNumber || tx.blockNumber || 0,
            timestamp: (await provider.getBlock(tx.blockNumber || 'latest'))?.timestamp || Math.floor(Date.now() / 1000),
            election_id: "election_001",
            voter_hash: voterHash,
            from: tx.from,
            to: tx.to,
            status: receipt?.status === 1 ? "confirmed" : "pending"
        });
    } catch (err) {
        console.error("Receipt fetch error:", err);
        return res.status(500).json({ error: "Failed to fetch receipt", details: err.message });
    }
});

// ── GET /api/booth/:booth_id/status — Proxy to ML service ──────────────────
app.get("/api/booth/:booth_id/status", async (req, res) => {
    const { booth_id } = req.params;
    
    try {
        const mlUrl = process.env.ML_SERVICE_URL || 'http://localhost:8001';
        const response = await fetch(`${mlUrl}/predict/peak-hours/${booth_id}`);
        
        if (!response.ok) {
            return res.status(response.status).json({ error: "ML service error" });
        }

        const data = await response.json();
        return res.json({
            booth_id,
            ...data,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error("Booth status fetch error:", err);
        return res.status(500).json({ error: "Failed to fetch booth status" });
    }
});

// ── Health check ──────────────────────────────────────────────────────────
app.get("/health", async (_req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ status: "ok", database: "connected" });
    } catch {
        res.status(503).json({ status: "error", database: "disconnected" });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀  Voting server running → http://localhost:${PORT}`);
    console.log(`    Admin portal → http://localhost:${PORT}/admin`);
    console.log(`    Results      → http://localhost:${PORT}/results`);
});
