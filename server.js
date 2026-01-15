// server.js — Backend Ticket de Voyage (Render OK)

const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");

// --------------------------------------------------
// Initialisation DB (stable sur Render)
// --------------------------------------------------
function initDb() {
  const db = new Database("db.sqlite");

  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      depart_at TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      seats_available INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT NOT NULL,
      trip_id INTEGER NOT NULL,
      passenger_name TEXT,
      status TEXT,
      price_cents INTEGER,
      created_at TEXT,
      paid_at TEXT,
      FOREIGN KEY (trip_id) REFERENCES trips(id)
    );
  `);

  return db;
}

// --------------------------------------------------
// App
// --------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

const db = initDb();

// --------------------------------------------------
// Utils
// --------------------------------------------------
function nowISO() {
  return new Date().toISOString();
}

// --------------------------------------------------
// GET all trips
// --------------------------------------------------
app.get("/trips", (req, res) => {
  const trips = db
    .prepare("SELECT * FROM trips ORDER BY depart_at ASC")
    .all();
  res.json(trips);
});

// --------------------------------------------------
// GET one trip
// --------------------------------------------------
app.get("/trips/:id", (req, res) => {
  const trip = db
    .prepare("SELECT * FROM trips WHERE id = ?")
    .get(req.params.id);

  if (!trip) return res.status(404).json({ error: "Trip not found" });
  res.json(trip);
});

// --------------------------------------------------
// CREATE trip (admin)
// --------------------------------------------------
app.post("/trips/create", (req, res) => {
  const { origin, destination, depart_at, capacity } = req.body;

  if (!origin || !destination || !depart_at || !capacity) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const result = db
    .prepare(`
      INSERT INTO trips (origin, destination, depart_at, capacity, seats_available)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(origin, destination, depart_at, capacity, capacity);

  const trip = db
    .prepare("SELECT * FROM trips WHERE id = ?")
    .get(result.lastInsertRowid);

  res.status(201).json(trip);
});

// --------------------------------------------------
// CREATE ticket
// --------------------------------------------------
app.post("/tickets", (req, res) => {
  const { trip_id, passenger_name, price_cents = 10000 } = req.body;

  if (!trip_id) {
    return res.status(400).json({ error: "trip_id required" });
  }

  const transaction = db.transaction(() => {
    const update = db
      .prepare(`
        UPDATE trips
        SET seats_available = seats_available - 1
        WHERE id = ? AND seats_available > 0
      `)
      .run(trip_id);

    if (update.changes !== 1) {
      throw new Error("No seats available");
    }

    const ref = uuidv4().slice(0, 8);

    const result = db
      .prepare(`
        INSERT INTO tickets (ref, trip_id, passenger_name, status, price_cents, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(ref, trip_id, passenger_name || null, "pending", price_cents, nowISO());

    return db
      .prepare("SELECT * FROM tickets WHERE id = ?")
      .get(result.lastInsertRowid);
  });

  try {
    const ticket = transaction();
    res.status(201).json(ticket);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// --------------------------------------------------
// PAY ticket
// --------------------------------------------------
app.post("/tickets/:ref/pay", (req, res) => {
  const ref = req.params.ref;

  const ticket = db
    .prepare("SELECT * FROM tickets WHERE ref = ?")
    .get(ref);

  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  if (ticket.status === "paid") return res.json(ticket);

  db.prepare(`
    UPDATE tickets
    SET status = ?, paid_at = ?
    WHERE ref = ?
  `).run("paid", nowISO(), ref);

  const updated = db
    .prepare("SELECT * FROM tickets WHERE ref = ?")
    .get(ref);

  res.json(updated);
});

// --------------------------------------------------
// CANCEL ticket
// --------------------------------------------------
app.post("/tickets/:ref/cancel", (req, res) => {
  const ref = req.params.ref;

  const ticket = db
    .prepare("SELECT * FROM tickets WHERE ref = ?")
    .get(ref);

  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE tickets SET status = ?
      WHERE ref = ?
    `).run("cancelled", ref);

    db.prepare(`
      UPDATE trips SET seats_available = seats_available + 1
      WHERE id = ?
    `).run(ticket.trip_id);

    return db
      .prepare("SELECT * FROM tickets WHERE ref = ?")
      .get(ref);
  });

  const updated = transaction();
  res.json(updated);
});

// --------------------------------------------------
// START server (Render compatible)
// --------------------------------------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("✅ Backend en ligne sur le port", PORT);
});
