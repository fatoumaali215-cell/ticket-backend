// server.js — API complet + Android support

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

async function initDb() {
  const db = await open({
    filename: path.join(__dirname, "db.sqlite"),
    driver: sqlite3.Database,
  });
  await db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

(async () => {
  const app = express();
  app.use(cors());
  app.use(bodyParser.json());

  const db = await initDb();

  function nowISO() {
    return new Date().toISOString();
  }

  // ---------------------------------------------------
  // 🔹 GET all trips
  // ---------------------------------------------------
  app.get("/trips", async (req, res) => {
    const trips = await db.all("SELECT * FROM trips ORDER BY depart_at ASC");
    res.json(trips);
  });

  // ---------------------------------------------------
  // 🔹 Get one trip
  // ---------------------------------------------------
  app.get("/trips/:id", async (req, res) => {
    const trip = await db.get("SELECT * FROM trips WHERE id = ?", req.params.id);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    res.json(trip);
  });

  // ---------------------------------------------------
  // 🔹 Create ticket
  // ---------------------------------------------------
  app.post("/tickets", async (req, res) => {
    const { trip_id, passenger_name, price_cents = 10000 } = req.body;

    if (!trip_id) return res.status(400).json({ error: "trip_id required" });

    try {
      await db.run("BEGIN");

      const updated = await db.run(
        "UPDATE trips SET seats_available = seats_available - 1 WHERE id = ? AND seats_available > 0",
        trip_id
      );

      if (updated.changes !== 1) {
        await db.run("ROLLBACK");
        return res.status(409).json({ error: "No seats available" });
      }

      const ref = uuidv4().slice(0, 8);

      const result = await db.run(
        "INSERT INTO tickets (ref, trip_id, passenger_name, status, price_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ref,
        trip_id,
        passenger_name || null,
        "pending",
        price_cents,
        nowISO()
      );

      await db.run("COMMIT");

      const ticket = await db.get("SELECT * FROM tickets WHERE id = ?", result.lastID);
      res.status(201).json(ticket);
    } catch (err) {
      console.error(err);
      await db.run("ROLLBACK");
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ---------------------------------------------------
  // 🔹 Pay ticket
  // ---------------------------------------------------
  app.post("/tickets/:ref/pay", async (req, res) => {
    const ref = req.params.ref;

    const ticket = await db.get("SELECT * FROM tickets WHERE ref = ?", ref);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    if (ticket.status === "paid") return res.json(ticket);

    await db.run(
      "UPDATE tickets SET status = ?, paid_at = ? WHERE ref = ?",
      "paid",
      nowISO(),
      ref
    );

    const updated = await db.get("SELECT * FROM tickets WHERE ref = ?", ref);
    res.json(updated);
  });

  // ---------------------------------------------------
  // 🔹 Cancel ticket
  // ---------------------------------------------------
  app.post("/tickets/:ref/cancel", async (req, res) => {
    const ref = req.params.ref;

    const ticket = await db.get("SELECT * FROM tickets WHERE ref = ?", ref);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    await db.run("BEGIN");

    await db.run("UPDATE tickets SET status = ? WHERE ref = ?", "cancelled", ref);
    await db.run("UPDATE trips SET seats_available = seats_available + 1 WHERE id = ?", ticket.trip_id);

    await db.run("COMMIT");

    const updated = await db.get("SELECT * FROM tickets WHERE ref = ?", ref);
    res.json(updated);
  });

  // ---------------------------------------------------
  // 🔹 Admin API: Create trip
  // ---------------------------------------------------
  app.post("/trips/create", async (req, res) => {
    const { origin, destination, depart_at, capacity } = req.body;

    if (!origin || !destination || !depart_at || !capacity)
      return res.status(400).json({ error: "Missing fields" });

    const result = await db.run(
      "INSERT INTO trips (origin, destination, depart_at, capacity, seats_available) VALUES (?, ?, ?, ?, ?)",
      origin,
      destination,
      depart_at,
      capacity,
      capacity
    );

    const trip = await db.get("SELECT * FROM trips WHERE id = ?", result.lastID);
    res.status(201).json(trip);
  });

  // ---------------------------------------------------
  // 🔥 Server accessible depuis Android
  // ---------------------------------------------------
 const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log("Backend en ligne sur le port", PORT);
});


})();
