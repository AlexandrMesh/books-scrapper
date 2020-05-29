const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const MongoClient = require('mongodb').MongoClient;

const url = 'https://www.labirint.ru/genres/1850/?page=2';
const category = 1;

const startScrapping = async (db, client) => {
  axios(url)
    .then(async response => {
      const html = response.data;
      const $ = cheerio.load(html);
      const bookItems = $('.catalog-responsive .products-row > .card-column');

      const boks = bookItems.map(async function (index) {
        if (index < 3) {
          const href = $(this).find('.product-cover .cover').attr('href') || $(this).find('.b-product-block-link').attr('href');
          const detailUrl = `https://www.labirint.ru${href}`;
          console.log(index);
          const bookInfo = await enterInsideDetailView(detailUrl, index);
          await insertDocuments(db, bookInfo);
        }
      }).get();

      console.log(boks, 'boks');

      Promise.all(boks).then(data => client.close());
    })
    .catch(console.error);
}

const enterInsideDetailView = (detailUrl, index) => {
  return new Promise(resolve => {
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
          resolve(bookInfo);
        });
      })
      .catch(console.error);
  });

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

const connectMongoDb = async () => {
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
  return new Promise(resolve => {
    collection.insertOne(query, (err, result) => {
      resolve(true);
    });
  });
}

connectMongoDb();
