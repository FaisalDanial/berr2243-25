1.Explain what is CRUD operations and how it is relates to the mongo functions in the exercise.

- Create, Read, Update, and Delete (CRUD) operations are the four essential tasks of permanent data storage. The MongoDB driver functions insertOne (Create), find (Read), updateOne/updateMany (Update) and deleteOne/deleteMany (Delete) that used in our exercise straight away relate to these.

2.Identify all the mongo operators used in the exercise, then explain the usage for each.

- $gte (Comparison Operator) 
 Stands for “Greater Than or Equal to”. The function is to be used in a query to find documents where a field value meets or exceeds a specified value like finding drivers with a rating of 4.5 or above.

- $inc (Update Operator)
 Stands for “Increment”. The function is to be used in an update to increase a field's value by a specified number like increasing a driver's rating by 0.1.