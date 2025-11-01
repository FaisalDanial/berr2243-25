const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const port = 3000

const app = express();
app.use(express.json());

// 🔥 ADD THIS CORS FIX 🔥
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

let db;

async function connectToMongoDB() {
    const uri = "mongodb://localhost:27017";
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log("Connected to MongoDB!");
        db = client.db("testDB");
    } catch (err) {
        console.error("Error:", err);
   }
}

connectToMongoDB();

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// --- USERS ENDPOINTS ---

// POST /users - Create a new user account
app.post('/users', async (req, res) => {
    try {
        const result = await db.collection('users').insertOne(req.body);
        // Status 201 Created
        res.status(201).json({ id: result.insertedId, message: "User created successfully" });
    } catch (err) {
        // Handle invalid data or DB errors
        res.status(400).json({ error: "Invalid user data" });
    }
});

// GET /users - Fetch all users
app.get('/users', async (req, res) => {
    try {
        const users = await db.collection('users').find().toArray();
        // Status 200 OK
        res.status(200).json(users);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

// PATCH /users/:id - Update user details (e.g., name, phone)
app.patch('/users/:id', async (req, res) => {
    try {
        // Use $set to update fields provided in the request body
        const result = await db.collection('users').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: req.body } 
        );

        if (result.modifiedCount === 0) {
            // If the ID is valid but no changes were made or the user wasn't found
            return res.status(404).json({ error: "User not found or no change made" });
        }
        // Status 200 OK
        res.status(200).json({ updated: result.modifiedCount });
    } catch (err) {
        // Handle invalid ID format or DB errors
        res.status(400).json({ error: "Invalid user ID or data" });
    }
});

// DELETE /users/:id - Delete a user account
app.delete('/users/:id', async (req, res) => {
    try {
        const result = await db.collection('users').deleteOne (
            { _id: new ObjectId(req.params.id) }
        );

        if (result.deletedCount === 0) {
            // If the ID is valid but the user wasn't found
            return res.status(404).json({ error: "User not found" });
        }
        // Status 200 OK
        res.status(200).json({ deleted: result.deletedCount, message: "User deleted" });

    } catch (err) {
        res.status(400).json({ error: "Invalid user ID" });
    }
});