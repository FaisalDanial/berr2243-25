const { MongoClient } = require('mongodb');

const drivers = [
    {
        name: "John Doe",
        vehicleType: "Sedan",
        isAvailable: true,
        rating: 4.8
    },
    {
        name: "Alice Smith",
        vehicleType: "SUV",
        isAvailable: false,
        rating: 4.5
    }
];

// show the data in the console
console.log(drivers);

// TODO: show the all the drivers name in the console
drivers.forEach((driver) => {
    console.log(driver.name);
});
// TODO: add additional driver to the drivers array
const count = drivers.push({
    name: "Danial",
    vehicleType: "Mazda",
    isAvailable: true,
    rating: 4.9
});
console.log(drivers);
console.log(count);

async function main() {

    // Replace <connection-string> with your MongoDB URI
    const uri = "mongodb://localhost:27017"
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db("testDB");

        const driversCollection = db.collection("drivers");

        drivers.forEach(async (driver) => {
            const result = await driversCollection.insertOne(driver);
            console.log(`New driver created with result: ${result}`);
        } );
        
        const updateResult = await db.collection('drivers').updateOne(
            { name: "John Doe" },
            { $inc: { rating: 0.1 } }
        );
        console.log(`Driver updated with result: ${updateResult}`);

        const deleteResult = await db.collection(`drivers`).deleteOne({isAvailable: false});
        console.log(`Driver deleted with result: ${deleteResult}`);

    } finally {
      await client.close();
    }
}

main();