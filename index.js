const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const MongoClient = require('mongodb').MongoClient;

const url = 'https://www.labirint.ru/genres/1850/?page=2';
const category = 1;


const startScrapping = (db, client) => {
  axios(url)
  .then(response => {
    const html = response.data;
    const $ = cheerio.load(html);
    const bookItems = $('.catalog-responsive .products-row > .card-column');
    const promises = bookItems.map(function (index) {
      if (index < 3) {
        const href = $(this).find('.product-cover .cover').attr('href') || $(this).find('.b-product-block-link').attr('href');
        const detailUrl = `https://www.labirint.ru${href}`;
        console.log(index);
        return enterInsideDetailView(detailUrl, index, db);
      }
    })

    Promise.all(promises)
      .then(results => {
        console.log('close');
        client.close();
      })
      .catch(e => {
        console.error(e);
      })
    })
  .catch(console.error);
}

const enterInsideDetailView = async (detailUrl, index, db) => {
  axios(detailUrl)
  .then(response => {
    const html = response.data;
    const $ = cheerio.load(html);
    const title = $('#product-title > h1').text();
    const imageSrc = $('#product-image > .book-img-cover').attr('data-src');
    const authors = $('#product-specs > .product-description > .authors > a').first().text();
    const description = $('#product-about > p').text();
    downloadImage(imageSrc, index).then(data => {
      const bookInfo = {
        title,
        category,
        bookCover: data,
        authors,
        description
      }
      
      return insertDocuments(db, bookInfo);
    });
  })
  .catch(console.error);
}

const downloadImage = async (imageSrc, index) => {  
  const imageTitle = `${index.toString()}.png`;
  const _path = path.resolve(__dirname, 'images', imageTitle)
  const writer = fs.createWriteStream(_path)

  const response = await axios({
    url: imageSrc,
    method: 'GET',
    responseType: 'stream'
  })

  response.data.pipe(writer)

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(imageTitle))
    writer.on('error', reject)
  })
}

const connectMongoDb = () => {
  // Connection URL
  const url = 'mongodb://localhost:27017';

  // Database Name
  const dbName = 'bookstracker';

  // Create a new MongoClient
  const client = new MongoClient(url, { useUnifiedTopology: true });

  // Use connect method to connect to the Server
  client.connect((err) => {
    console.log("Connected successfully to server");

    const db = client.db(dbName);

    startScrapping(db, client);
    
  });
}

const insertDocuments = async (db, query) => {
  // Get the documents collection
  const collection = db.collection('books');
  // Insert some documents
  new Promise((resolve) => {
    collection.insertOne(query, (err, result) => {
      console.log("Inserted");
      return true;
    });
  });
}

connectMongoDb();
