const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

require('dotenv').config();

// Debug Environment
console.log('=== MAXIM SERVER STARTING ===');
console.log('PORT:', process.env.PORT || '3000');

const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "maxim_secret_key_123";
const SALT_ROUNDS = 10;

const app = express();
app.use(express.json());

// CORS Middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

// REQUEST LOGGER (See what is happening!)
app.use((req, res, next) => {
    console.log(`➡️  INCOMING REQUEST: ${req.method} ${req.url}`);
    next();
});

let db;

// ==================== DATABASE INITIALIZATION ====================
async function connectToMongoDB() {
    const uri = process.env.MONGODB_URI || "mongodb+srv://FaisalDanial:JaiSoba02%40@benr2423.m9n3hhm.mongodb.net/maximDB?appName=BENR2423";
    const client = new MongoClient(uri);
    try {
        await client.connect();
        db = client.db("maximDB");
        console.log("✅ Connected to MongoDB: maximDB");
        
        await db.collection('customers').createIndex({ email: 1 }, { unique: true });
        await db.collection('drivers').createIndex({ email: 1 }, { unique: true });
        await db.collection('admins').createIndex({ email: 1 }, { unique: true });
        
        const rates = await db.collection('rates').findOne({ type: 'standard' });
        if (!rates) {
            await db.collection('rates').insertOne({
                type: 'standard', baseFare: 5.00, perKm: 2.50, updatedAt: new Date(), updatedBy: 'system'
            });
        }
    } catch (err) {
        console.error("❌ MongoDB Connection Error:", err);
    }
}
connectToMongoDB();

function getMalaysiaTime() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
}

// ==================== MIDDLEWARE ====================

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Access token required" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Invalid token" });
        req.user = user;
        next();
    });
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Admin access required" });
    next();
};

// ==================== ROOT ENDPOINT ====================
// Simple root endpoint to show API is running

app.get('/', (req, res) => {
    res.json({ message: "🚀 Maxim Backend API is running!", timestamp: getMalaysiaTime() });
});

// ⭐ AVAILABLE RIDES (For Drivers)
app.get('/api/rides/available', authenticateToken, async (req, res) => {
    console.log("✅ HIT: /api/rides/available endpoint"); // Debug Log
    try {
        if (req.user.role !== 'driver') return res.status(403).json({ error: "Not a driver" });

        const driver = await db.collection('drivers').findOne({ _id: new ObjectId(req.user.id) });
        if (!driver) return res.status(404).json({ error: "Driver not found" });

        if (driver.availabilityStatus !== 'online') {
            return res.status(403).json({ error: "You are offline. Go Online to see rides." });
        }

        const rides = await db.collection('rides').find({ status: 'requested' }).toArray();
        res.json(rides);

    } catch (err) {
        console.error("❌ SERVER CRASH in available:", err);
        res.status(500).json({ error: "Server Error" });
    }
});

// ⭐ RIDE HISTORY (For All)
app.get('/api/rides/history/all', authenticateToken, async (req, res) => {
    console.log("✅ HIT: /api/rides/history/all endpoint"); // Debug Log
    try {
        let query = {};
        if (req.user.role === 'customer') query = { customerId: new ObjectId(req.user.id) };
        else if (req.user.role === 'driver') query = { driverId: new ObjectId(req.user.id) };
        
        const rides = await db.collection('rides').find(query).sort({ createdAt: -1 }).toArray();
        res.json(rides);
    } catch (err) { res.status(500).json({ error: "Server Error" }); }
});

// ==================== AUTHENTICATION ====================

app.post('/api/auth/register/customer', async (req, res) => {
    try {
        const { email, password, name, phone } = req.body;
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const result = await db.collection('customers').insertOne({
            email, passwordHash, name, phone, role: 'customer', isBlocked: false, createdAt: getMalaysiaTime()
        });
        res.status(201).json({ message: "Customer created", userId: result.insertedId });
    } catch (err) { res.status(409).json({ error: "Email already exists" }); }
});

app.post('/api/auth/register/driver', async (req, res) => {
    try {
        const { email, password, name, vehicleDetails } = req.body;
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const result = await db.collection('drivers').insertOne({
            email, passwordHash, name, vehicleDetails,
            role: 'driver', availabilityStatus: 'offline', isBlocked: false, walletBalance: 0.00, createdAt: getMalaysiaTime()
        });
        res.status(201).json({ message: "Driver created", driverId: result.insertedId });
    } catch (err) { res.status(409).json({ error: "Email already exists" }); }
});

app.post('/api/auth/register/admin', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const result = await db.collection('admins').insertOne({
            email, passwordHash, name, role: 'admin', isBlocked: false, createdAt: getMalaysiaTime()
        });
        res.status(201).json({ message: "Admin created", adminId: result.insertedId });
    } catch (err) { res.status(400).json({ error: "Error creating admin" }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        let user = await db.collection('customers').findOne({ email });
        if (!user) user = await db.collection('drivers').findOne({ email });
        if (!user) user = await db.collection('admins').findOne({ email });

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: "Invalid credentials" });
        }
        if (user.isBlocked) return res.status(403).json({ error: "Account is blocked by Admin." });

        const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ message: `Login successful as ${user.role}`, token, role: user.role, userId: user._id });
    } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        let collectionName = 'customers';
        if (req.user.role === 'driver') collectionName = 'drivers';
        if (req.user.role === 'admin') collectionName = 'admins';

        const user = await db.collection(collectionName).findOne({ _id: new ObjectId(req.user.id) });
        if (!user) return res.status(404).json({ error: "User not found" });
        
        const { passwordHash, ...safeUser } = user; 
        res.json(safeUser);
    } catch (err) { res.status(500).json({ error: "Server Error" }); }
});

// ==================== RIDE ACTIONS (ID Routes last) ====================


app.post('/api/rides', authenticateToken, async (req, res) => {
    if (req.user.role !== 'customer') return res.status(403).json({ error: "Only customers can book" });
    const { pickupLocation, dropoffLocation, distanceKm } = req.body;
    
    const rate = await db.collection('rates').findOne({ type: 'standard' });
    const dist = distanceKm || 5; 
    const estFare = (rate.baseFare + (rate.perKm * dist));

    const rideData = {
        customerId: new ObjectId(req.user.id),
        pickupLocation, dropoffLocation, distanceKm: dist,
        status: 'requested', estimatedFare: parseFloat(estFare.toFixed(2)), driverId: null, createdAt: getMalaysiaTime()
    };
    const result = await db.collection('rides').insertOne(rideData);
    res.status(201).json({ message: "Ride requested", rideId: result.insertedId, fare: rideData.estimatedFare });
});

app.patch('/api/rides/:id/cancel', authenticateToken, async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid ID" });
    const result = await db.collection('rides').updateOne(
        { _id: new ObjectId(req.params.id), customerId: new ObjectId(req.user.id), status: 'requested' },
        { $set: { status: 'cancelled', cancelledAt: getMalaysiaTime() } }
    );
    if (result.modifiedCount === 0) return res.status(409).json({ error: "Cannot cancel ride." });
    res.json({ message: "Ride cancelled" });
});

app.patch('/api/rides/:id/rate', authenticateToken, async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid ID" });
    const { rating } = req.body; 
    await db.collection('rides').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { rating: parseInt(rating) } });
    res.json({ message: "Driver rated successfully! ⭐" });
});

// 👇 THE GENERIC ID ROUTE (MUST BE LAST)
app.get('/api/rides/:id', authenticateToken, async (req, res) => {
    console.log(`⚠️ Hitting Generic ID Route for: ${req.params.id}`); // Debug Log

    if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: "Invalid ID format for ride lookup" });
    }
    try {
        const ride = await db.collection('rides').findOne({ _id: new ObjectId(req.params.id) });
        if (!ride) return res.status(404).json({ error: "Ride not found" });
        res.json(ride);
    } catch (err) { res.status(500).json({ error: "Server Error" }); }
});

// ==================== DRIVER ACTIONS ====================

app.patch('/api/drivers/status', authenticateToken, async (req, res) => {
    if (req.user.role !== 'driver') return res.status(403).json({ error: "Not a driver" });
    const { status } = req.body; 
    if (status === 'online') {
        const driver = await db.collection('drivers').findOne({ _id: new ObjectId(req.user.id) });
        if (!driver.vehicleDetails) return res.status(400).json({ error: "Register vehicle first." });
    }
    await db.collection('drivers').updateOne({ _id: new ObjectId(req.user.id) }, { $set: { availabilityStatus: status } });
    res.json({ message: `Status updated to ${status}` });
});

app.patch('/api/rides/:id/accept', authenticateToken, async (req, res) => {
    if (req.user.role !== 'driver') return res.status(403).json({ error: "Not a driver" });
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid ID" });

    const result = await db.collection('rides').updateOne(
        { _id: new ObjectId(req.params.id), status: 'requested' }, 
        { $set: { status: 'accepted', driverId: new ObjectId(req.user.id), acceptedAt: getMalaysiaTime() } }
    );
    if (result.modifiedCount === 0) return res.status(409).json({ error: "Ride already taken." });
    res.json({ message: "Ride accepted" });
});

app.patch('/api/rides/:id/complete', authenticateToken, async (req, res) => {
    if (req.user.role !== 'driver') return res.status(403).json({ error: "Not a driver" });
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid ID" });

const ride = await db.collection('rides').findOne({ _id: new ObjectId(req.params.id), driverId: new ObjectId(req.user.id) });
    if (!ride) return res.status(404).json({ error: "Ride not found or not yours" });

    await db.collection('rides').updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: 'completed', completedAt: getMalaysiaTime(), finalFare: ride.estimatedFare } }
    );
    await db.collection('drivers').updateOne({ _id: new ObjectId(req.user.id) }, { $inc: { walletBalance: ride.estimatedFare } });
    res.json({ message: "Ride completed", earned: ride.estimatedFare });
});

// ==================== ADMIN ENDPOINTS ====================

app.post('/api/admin/rates', authenticateToken, isAdmin, async (req, res) => {
    const { baseFare, perKm } = req.body;
    await db.collection('rates').updateOne(
        { type: 'standard' },
        { $set: { baseFare, perKm, updatedBy: req.user.email, updatedAt: getMalaysiaTime() } },
        { upsert: true }
    );
    res.json({ message: "Global rates updated" });
});

app.get('/api/admin/rates', authenticateToken, isAdmin, async (req, res) => {
    const rates = await db.collection('rates').findOne({ type: 'standard' });
    res.json(rates);
});

app.get('/api/admin/users', authenticateToken, isAdmin, async (req, res) => {
    const customers = await db.collection('customers').find().toArray();
    const drivers = await db.collection('drivers').find().toArray();
    const admins = await db.collection('admins').find().toArray();
    res.json({ counts: { customers: customers.length, drivers: drivers.length, admins: admins.length }, customers, drivers, admins });
});

app.patch('/api/admin/users/:id/block', authenticateToken, isAdmin, async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid ID" });
    const { isBlocked } = req.body;
    let result = await db.collection('customers').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { isBlocked } });
    if (result.matchedCount === 0) result = await db.collection('drivers').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { isBlocked } });
    if (result.matchedCount === 0) result = await db.collection('admins').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { isBlocked } });
    if (result.matchedCount === 0) return res.status(404).json({ error: "User not found" });
    res.json({ message: `Block status updated to ${isBlocked}` });
});

app.delete('/api/admin/users/:id', authenticateToken, isAdmin, async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid ID" });
    let result = await db.collection('customers').deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) result = await db.collection('drivers').deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) result = await db.collection('admins').deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: "User not found" });
    res.status(204).send();
});

// ==================== SERVER START ====================
app.listen(port, () => {
    console.log(`🚀 Maxim App Server running on port ${port}`);
});