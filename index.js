const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");


const userRoutes = require("./routes/user")
const productRoutes = require("./routes/product")
const cartRoutes = require("./routes/cart")
const orderRoutes = require("./routes/order")


require('dotenv').config();

const app = express();

mongoose.connect(process.env.MONGODB_STRING);

mongoose.connection.once('open', () => console.log('Now connected to MongoDB Atlas'));

app.use(express.json());
app.use(express.urlencoded({extended:true}));


const corsOptions = {
    origin: [
        'http://localhost:3000', 
        'http://zuitt-bootcamp-prod-495-8145-ortega.s3-website.us-east-1.amazonaws.com',
        'http://zuitt-bootcamp-prod-495-8229-bamba.s3-website.us-east-1.amazonaws.com'
    ],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
// app.use(cors());


// Backend routes for user 
app.use("/b1/users", userRoutes);
// Backend routes for products
app.use("/b1/products", productRoutes);
// Backend routes for cart 
app.use("/b1/cart", cartRoutes);
// Backend routes for order
app.use("/b1/orders", orderRoutes);



// Checking and running server
if(require.main === module){
	app.listen(process.env.PORT || 3000, () => {
		console.log(`API is now online on port ${ process.env.PORT || 3000}`)
	});
}


module.exports = {app, mongoose};