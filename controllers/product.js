const Product = require("../models/Product.js");
const { errorHandler } = require("../auth.js");
// const User = require("../models/User.js");





// Create Product
module.exports.createProduct = (req, res) => {
    const { name, description, price } = req.body;

    let newProduct = new Product({
        name,
        description,
        price
    });
    Product.findOne({ name })
        .then(existingProduct => {
            if (existingProduct) {
                return res.status(404).send({ error: 'Product already exists' });
            } else {

                return newProduct.save()
                    .then(result => {
                        return res.status(201).send(result);
                    })
                    .catch(error => errorHandler(error, req, res));
            }
        })
        .catch(error => errorHandler(error, req, res));
};
 


// Retrieve all products
module.exports.retrieveAllProducts = (req, res) => {
    return Product.find({})
    .then(result => {
        
        if(result.length > 0){
            return res.status(200).send(result);
        }
        else{
            
            return res.status(404).send({message: 'No products found'});
        }
    })
    .catch(error => errorHandler(error, req, res));
};


// Retrieve all active products
module.exports.retrieveAllActive = (req, res) => {

    Product.find({ isActive: true })
    .then(result => {

        if(result.length > 0){
            return res.status(200).send(result)
        }
        else{ 

            return res.status(404).send({ message: 'No active products found' });
            
        }
    })
    .catch(error => errorHandler(error, req, res));
};


// Retrieve single product
module.exports.retrieveSingleProduct = (req, res) => {
    Product.findById(req.params.productId) 
    .then(product => {
        if (product) {
            return res.status(200).send(product);
        } else {
            return res.status(404).send({ message: 'Product not found' });
        }
    })
    .catch(error => errorHandler(error, req, res)); 
};


// Update product
module.exports.updateProduct = (req, res)=>{

    let updatedProduct = {
        name: req.body.name,
        description: req.body.description,
        price: req.body.price
    }

    return Product.findByIdAndUpdate(req.params.productId, updatedProduct)
    .then(product => {
        if (product) {
            res.status(200).send({ success: true, message: 'Product updated successfully' });
        } else {
            res.status(404).send({ message: 'Product not found' });
        }
    })
    .catch(error => errorHandler(error, req, res));
};


// Archive Product 
module.exports.archiveProduct = (req, res) => {
  
    let updateActiveField = {
        isActive: false
    };

    Product.findByIdAndUpdate(req.params.productId, updateActiveField)
        .then(product => {
            if (product) {
                if (!product.isActive) {
                  
                    return res.status(200).send({ 
                        message: 'Product already archived',
                        archivedProduct: product
                        });
                }
                
                return res.status(200).send({ 
                            message: 'Product archived successfully'
                        });
            } else {
                
                return res.status(404).send({ error: 'Product not found' });
            }
        })
        .catch(error => errorHandler(error, req, res));
};


// Activate Product
module.exports.activateProduct = (req, res) => {
  
    let updateActiveField = {
        isActive: true
    }

    Product.findByIdAndUpdate(req.params.productId, updateActiveField)
        .then(product => {
            
            if (product) {
                
                if (product.isActive) {
                    
                    return res.status(200).send({ 
                        message: 'Product already activated', 
                        activateProduct: product
                    });
                }
                
                return res.status(200).send({
                    message: 'Product activated successfully'
                });
            } else {
                
                return res.status(404).send({ error: 'Product not found' });
            }
        })
        .catch(error => errorHandler(error, req, res));
};


// Search product by name
module.exports.searchByName = (req, res) => {
    const { productName } = req.body;

    if (!productName || typeof productName !== 'string') {
        return res.status(200).json([]);
    }

    Product.findOne({ name: productName })
        .then(product => {
            if (!product) {
                return res.status(200).json([]);
            }

            res.json(product);
        })
        .catch(error => errorHandler(error, req, res));
};



// Search product by price
module.exports.searchByPrice = (req, res) => {
    const { minPrice, maxPrice } = req.body;

    Product.find({ price: { $gte: minPrice, $lte: maxPrice } })
        .then(products => {
            if (products.length === 0) {
                res.status(404).send({ message: 'No products found within the specified price range' });
            } else {
                res.status(200).send(products);
            }
        })
        .catch(error => errorHandler(error, req, res));

};