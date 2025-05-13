const mongoose = require('mongoose');

const connectDB = () => {
  mongoose.connect("mongodb+srv://samiran4209:Samiran123@cluster0.2n0s5.mongodb.net/");
  console.log("mongoDB database connected");
};

module.exports = connectDB;
