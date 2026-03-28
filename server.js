const express = require("express");
const initSqlJs = require("sql.js");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "health_helper.db");

// ── Middleware ──
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Database ──
let db;

async function initDB() {
  const SQL = await initSqlJs();

  // Load existing DB file if it exists, otherwise create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    console.log("  Loaded existing database.");
  } else {
    db = new SQL.Database();
    console.log("  Created new database.");
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      verified INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS verification_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      code TEXT NOT NULL,
      method TEXT DEFAULT 'call',
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS insurance_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      member_id TEXT NOT NULL,
      plan_type TEXT,
      holder_name TEXT,
      effective_date TEXT,
      group_num TEXT,
      raw_text TEXT,
      scanned_at TEXT DEFAULT (datetime('now'))
    )
  `);

  saveDB();
}

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ── Helper: Generate a 4-digit code ──
function generateCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// ══════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════

// POST /api/send-code
// Accepts { phone, method } → generates and stores a 4-digit code
app.post("/api/send-code", (req, res) => {
  const { phone, method = "call" } = req.body;

  if (!phone || !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ error: "Please provide a valid 10-digit phone number." });
  }

  // Upsert user
  const existing = db.exec("SELECT id FROM users WHERE phone = ?", [phone]);
  if (existing.length === 0 || existing[0].values.length === 0) {
    db.run("INSERT INTO users (phone) VALUES (?)", [phone]);
  }

  // Invalidate previous unused codes for this phone
  db.run("UPDATE verification_codes SET used = 1 WHERE phone = ? AND used = 0", [phone]);

  // Generate new code
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min expiry

  db.run(
    "INSERT INTO verification_codes (phone, code, method, expires_at) VALUES (?, ?, ?, ?)",
    [phone, code, method, expiresAt]
  );

  saveDB();

  // ┌──────────────────────────────────────────────────────────┐
  // │  In production, call Twilio / Vonage here to deliver     │
  // │  the code via SMS or voice call.                         │
  // │  For development, we print it to the server console.     │
  // └──────────────────────────────────────────────────────────┘
  console.log(`\n  Verification code for ${phone}: ${code}  (method: ${method})\n`);

  res.json({
    success: true,
    message: `Code sent via ${method}. Check the server console for the code during development.`,
    // DEVELOPMENT ONLY — remove this line before deploying!
    _dev_code: code,
  });
});

// POST /api/verify-code
// Accepts { phone, code } → verifies and marks user as verified
app.post("/api/verify-code", (req, res) => {
  const { phone, code } = req.body;

  if (!phone || !code) {
    return res.status(400).json({ error: "Phone and code are required." });
  }

  const now = new Date().toISOString();
  const result = db.exec(
    "SELECT id FROM verification_codes WHERE phone = ? AND code = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
    [phone, code, now]
  );

  if (result.length === 0 || result[0].values.length === 0) {
    return res.status(401).json({ error: "Invalid or expired code. Please try again." });
  }

  const codeId = result[0].values[0][0];

  // Mark code as used
  db.run("UPDATE verification_codes SET used = 1 WHERE id = ?", [codeId]);

  // Mark user as verified and update last login
  db.run("UPDATE users SET verified = 1, last_login = datetime('now') WHERE phone = ?", [phone]);

  saveDB();

  const userResult = db.exec("SELECT id, phone, verified, created_at, last_login FROM users WHERE phone = ?", [phone]);
  const row = userResult[0].values[0];
  const user = {
    id: row[0],
    phone: row[1],
    verified: !!row[2],
    createdAt: row[3],
    lastLogin: row[4],
  };

  console.log(`\n  User verified: ${phone}\n`);

  res.json({
    success: true,
    message: "Phone verified successfully!",
    user,
  });
});

// GET /api/users
// Admin view — lists all registered users
app.get("/api/users", (req, res) => {
  const result = db.exec("SELECT id, phone, verified, created_at, last_login FROM users ORDER BY created_at DESC");

  if (result.length === 0) {
    return res.json({ total: 0, users: [] });
  }

  const users = result[0].values.map((row) => ({
    id: row[0],
    phone: row[1],
    verified: !!row[2],
    createdAt: row[3],
    lastLogin: row[4],
  }));

  res.json({ total: users.length, users });
});

// POST /api/save-card
// Saves scanned card data and returns demo beneficiary record
app.post("/api/save-card", (req, res) => {
  const { phone, memberId, planType, name, effectiveDate, groupNum, rawText } = req.body;

  if (!phone || !memberId) {
    return res.status(400).json({ error: "Phone and member ID are required." });
  }

  db.run(
    `INSERT INTO insurance_cards (phone, member_id, plan_type, holder_name, effective_date, group_num, raw_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [phone, memberId, planType || "", name || "", effectiveDate || "", groupNum || "", rawText || ""]
  );
  saveDB();

  console.log(`\n  Card saved for ${phone}: ${memberId}\n`);

  const demo = generateDemoData(memberId, planType, name, effectiveDate, groupNum, rawText);
  res.json({ success: true, data: demo });
});

// GET /api/cards/:phone
// Retrieves all scanned cards for a user
app.get("/api/cards/:phone", (req, res) => {
  const { phone } = req.params;
  const result = db.exec(
    "SELECT id, member_id, plan_type, holder_name, effective_date, group_num, scanned_at FROM insurance_cards WHERE phone = ? ORDER BY scanned_at DESC",
    [phone]
  );

  if (result.length === 0) return res.json({ cards: [] });

  const cards = result[0].values.map(r => ({
    id: r[0], memberId: r[1], planType: r[2], name: r[3],
    effectiveDate: r[4], groupNum: r[5], scannedAt: r[6],
  }));
  res.json({ cards });
});

function generateDemoData(memberId, planType, holderName, effectiveDate, groupNum, rawText) {
  const raw = rawText || "";
  const upper = raw.toUpperCase();
  const v = (val) => val && val !== "Not detected" ? val : "";

  // Use whatever the OCR actually read
  const mbi = v(memberId);
  const name = v(holderName);
  const plan = v(planType);
  const effDate = v(effectiveDate);
  const group = v(groupNum);

  // Mine the raw text for additional fields the basic extractor didn't grab
  const parsed = parseRawText(raw);

  // All dates found on the card
  const allDates = raw.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/g) || [];
  const dob = parsed.dob || (allDates.length >= 2 ? allDates[1] : "");
  const primaryDate = effDate || (allDates.length >= 1 ? allDates[0] : "");

  // Copay values found on card
  const copays = parsed.copays;

  return {
    personal: {
      mbi: mbi || "—",
      fullName: name || "—",
      dateOfBirth: dob || "—",
      gender: parsed.gender || "—",
      phone: parsed.phone || "—",
      address: parsed.address || "—",
      city: parsed.city || "—",
      state: parsed.state || "—",
      zip: parsed.zip || "—",
    },
    ssaRecord: {
      nameOnRecord: name ? name.toUpperCase() : "—",
      address: parsed.fullAddress ? parsed.fullAddress.toUpperCase() : "—",
      dateOfBirth: dob || "—",
      ssn: parsed.ssn || "—",
      claimNumber: mbi || "—",
    },
    eligibility: {
      status: mbi ? "Active" : "—",
      partA: {
        enrolled: upper.includes("PART A") || upper.includes("HOSPITAL") || !!mbi,
        effectiveDate: parsed.partADate || primaryDate || "—",
        premium: parsed.partAPremium || "—",
      },
      partB: {
        enrolled: upper.includes("PART B") || upper.includes("MEDICAL") || !!mbi,
        effectiveDate: parsed.partBDate || primaryDate || "—",
        premium: parsed.partBPremium || "—",
      },
      partD: {
        enrolled: upper.includes("PART D") || upper.includes("RX") || upper.includes("PRESCRIPTION"),
        effectiveDate: parsed.partDDate || primaryDate || "—",
        premium: parsed.partDPremium || "—",
      },
      esrd: upper.includes("ESRD"),
      hospice: upper.includes("HOSPICE"),
      dualEligible: upper.includes("MEDICAID") || upper.includes("DUAL") ? "Yes" : "—",
    },
    plan: {
      name: plan || "—",
      carrier: parsed.carrier || plan || "—",
      contractId: parsed.contractId || "—",
      pbpId: parsed.pbpId || "—",
      groupNumber: group || "—",
      effectiveDate: primaryDate || "—",
      memberId: mbi || "—",
      lisSubsidy: upper.includes("LIS") || upper.includes("SUBSID") || upper.includes("EXTRA HELP") ? "Yes" : "—",
      copaySummary: copays,
    },
    claims: parsed.rxBin ? [
      { date: primaryDate || "—", provider: parsed.carrier || plan || "Card Issuer", type: "Rx Benefit — " + (parsed.rxBin ? "BIN " + parsed.rxBin : "Active"), billed: "—", allowed: "—", paid: "—", youOwe: copays.generic || "—", status: mbi ? "Active" : "—" },
    ] : [],
    rawFields: parsed.extraFields,
  };
}

function parseRawText(raw) {
  const upper = raw.toUpperCase();
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const result = {
    dob: "", gender: "", phone: "", address: "", city: "", state: "", zip: "",
    fullAddress: "", ssn: "", carrier: "", contractId: "", pbpId: "",
    partADate: "", partBDate: "", partDDate: "",
    partAPremium: "", partBPremium: "", partDPremium: "",
    rxBin: "", rxPcn: "", rxGroup: "",
    copays: { pcp: "—", specialist: "—", urgentCare: "—", er: "—", generic: "—", preferred: "—" },
    extraFields: [],
  };

  // DOB: look for "DOB" or "BIRTH" keyword followed by a date
  const dobMatch = raw.match(/(?:DOB|DATE\s*OF\s*BIRTH|BIRTH\s*DATE|BORN)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (dobMatch) result.dob = dobMatch[1];

  // Gender
  if (/\b(MALE|FEMALE)\b/i.test(raw)) result.gender = raw.match(/\b(MALE|FEMALE)\b/i)[1];
  else if (/\bSEX[:\s]*(M|F)\b/i.test(raw)) result.gender = raw.match(/\bSEX[:\s]*(M|F)\b/i)[1] === "M" ? "Male" : "Female";

  // Phone number on card
  const phoneMatch = raw.match(/(?:PHONE|TEL|CALL)[:\s]*[(\s]*(\d{3})[)\s\-]*(\d{3})[\s\-]*(\d{4})/i);
  if (phoneMatch) result.phone = `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}`;

  // Address: look for common patterns (number + street)
  const addrMatch = raw.match(/(\d{1,6}\s+[A-Za-z0-9\s.]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place)[.,]?)/i);
  if (addrMatch) result.address = addrMatch[1].trim();

  // State + ZIP
  const stateZipMatch = raw.match(/\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/);
  if (stateZipMatch) { result.state = stateZipMatch[1]; result.zip = stateZipMatch[2]; }

  // City: word(s) before state
  if (result.state) {
    const cityMatch = raw.match(new RegExp("([A-Za-z\\s]+)[,.]?\\s*" + result.state + "\\s+\\d{5}"));
    if (cityMatch) result.city = cityMatch[1].trim();
  }

  // Full address
  const parts = [result.address, result.city, result.state, result.zip].filter(Boolean);
  if (parts.length > 0) result.fullAddress = parts.join(", ");

  // SSN (masked usually on cards)
  const ssnMatch = raw.match(/\b(XXX-XX-\d{4}|\*{3}-\*{2}-\d{4}|\d{3}-\d{2}-\d{4})\b/);
  if (ssnMatch) result.ssn = ssnMatch[1];

  // Carrier / Issuer
  const carriers = ["UNITEDHEALTHCARE","UNITED HEALTHCARE","UHC","AETNA","CIGNA","HUMANA","BLUE CROSS","BLUE SHIELD","BCBS","ANTHEM","KAISER","CENTENE","MOLINA","WELLCARE","WELLPOINT","CARESOURCE","AMBETTER"];
  for (const c of carriers) {
    if (upper.includes(c)) { result.carrier = c.split(" ").map(w => w[0] + w.slice(1).toLowerCase()).join(" "); break; }
  }

  // Contract / PBP IDs
  const contractMatch = raw.match(/(?:CONTRACT|H\d{4})\b[:\s]*(H\d{4})/i);
  if (contractMatch) result.contractId = contractMatch[1];
  else { const hMatch = raw.match(/\b(H\d{4})\b/); if (hMatch) result.contractId = hMatch[1]; }
  const pbpMatch = raw.match(/(?:PBP|PLAN)[:\s#]*(\d{3})/i);
  if (pbpMatch) result.pbpId = pbpMatch[1];

  // Part-specific dates
  const partAMatch = raw.match(/PART\s*A[^:]*[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (partAMatch) result.partADate = partAMatch[1];
  const partBMatch = raw.match(/PART\s*B[^:]*[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (partBMatch) result.partBDate = partBMatch[1];
  const partDMatch = raw.match(/PART\s*D[^:]*[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (partDMatch) result.partDDate = partDMatch[1];

  // Premium amounts
  const premiumMatch = (label) => {
    const m = raw.match(new RegExp(label + "[^$]*\\$([\\d,.]+)", "i"));
    return m ? "$" + m[1] + "/mo" : "";
  };
  result.partAPremium = premiumMatch("PART\\s*A");
  result.partBPremium = premiumMatch("PART\\s*B") || premiumMatch("PREMIUM");
  result.partDPremium = premiumMatch("PART\\s*D");

  // Rx info (BIN, PCN, Group)
  const binMatch = raw.match(/(?:RX\s*)?BIN[:\s]*(\d{6})/i);
  if (binMatch) result.rxBin = binMatch[1];
  const pcnMatch = raw.match(/PCN[:\s]*([A-Z0-9]+)/i);
  if (pcnMatch) result.rxPcn = pcnMatch[1];
  const rxGrpMatch = raw.match(/RX\s*(?:GROUP|GRP)[:\s#]*([A-Z0-9]+)/i);
  if (rxGrpMatch) result.rxGroup = rxGrpMatch[1];

  // Copay amounts
  const copayMatch = (label) => {
    const m = raw.match(new RegExp(label + "[^$]*\\$([\\d,.]+)", "i"));
    return m ? "$" + m[1] : "—";
  };
  result.copays.pcp = copayMatch("(?:PCP|PRIMARY|OFFICE\\s*VISIT)");
  result.copays.specialist = copayMatch("SPECIALIST");
  result.copays.urgentCare = copayMatch("URGENT");
  result.copays.er = copayMatch("(?:ER|EMERGENCY)");
  result.copays.generic = copayMatch("GENERIC");
  result.copays.preferred = copayMatch("PREFERRED");

  // Collect any other labeled fields from the raw text (KEY: VALUE or KEY VALUE patterns)
  for (const line of lines) {
    const kvMatch = line.match(/^([A-Z][A-Za-z\s]{2,20})[:\s]{1,3}(.{2,})$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const val = kvMatch[2].trim();
      if (val.length > 1 && val.length < 80) {
        result.extraFields.push({ label: key, value: val });
      }
    }
  }

  return result;
}

// DELETE /api/users/:phone
// Remove a user (admin)
app.delete("/api/users/:phone", (req, res) => {
  const { phone } = req.params;
  db.run("DELETE FROM verification_codes WHERE phone = ?", [phone]);
  db.run("DELETE FROM users WHERE phone = ?", [phone]);
  saveDB();
  res.json({ success: true, message: `User ${phone} deleted.` });
});

// Fallback: serve the frontend
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start ──
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  Health Helper server running at http://localhost:${PORT}`);
    console.log(`  Admin panel (JSON): http://localhost:${PORT}/api/users\n`);
  });
});
