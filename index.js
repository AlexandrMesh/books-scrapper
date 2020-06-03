const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const shortid = require('shortid');
const MongoClient = require('mongodb').MongoClient;

const mongoDbUrl = 'mongodb://localhost:27017';
const dbName = 'bookstracker';
const collectionName = 'books';

const baseUrl = "https://www.labirint.ru";
const categoryUrl = `${baseUrl}/genres/2304/?page=4`;
const category = 1;

const limitImagesInFolder = 3;
const rootImagesFolderName = 'images';
let imagesFolderName = `${rootImagesFolderName}/${shortid.generate()}`;

const imageType = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png'
}

const getImageType = headers => {
  return imageType[headers['content-type']] || imageType['image/jpeg']
}

const getNumbersFromString = string => string.match(/\d+/g).map(Number);

const startScrapping = async (db, client) => {
  axios(categoryUrl)
    .then(async response => {
      try {
        const html = response.data;
        const $ = cheerio.load(html);
        const bookItems = $('.catalog-responsive .products-row > .card-column:not(.responsive-promoblock)');

        const books = bookItems.map(async (index, element) => {
          if (index < 10) {
            const href = $(element).find('.product-cover .cover').attr('href') || $(element).find('.b-product-block-link').attr('href');
            const detailUrl = `${baseUrl}${href}`;
            const bookTitle = $(element).find('.product-cover .product-title-link .product-title').text();
            console.log(index);
            const bookInfo = await setBookInfo(detailUrl, bookTitle);
            await insertDocument(db, bookInfo);
          }
        }).get();

        Promise.all(books).then(() => client.close());
      } catch (error) {
        console.log(error);
      }
    })
    .catch(error => console.log(error));
}

const setBookInfo = (detailUrl, bookTitle) => {
  return new Promise(resolve => {
    axios(detailUrl)
      .then(response => {
        const html = response.data;
        const $ = cheerio.load(html);
        const imageSrc = $('#product-image > .book-img-cover').attr('data-src');
        const authors = $('#product-specs > .product-description > .authors > a[data-event-label="author"]');
        const isbn = $('#product-specs > .product-description > .isbn').text();
        const pages = $('#product-specs > .product-description > .pages2').text();
        const publisher = $('#product-specs > .product-description > .publisher > a[data-event-label="publisher"]').text();
        const year = $('#product-specs > .product-description > .publisher').text();
        const votesCount = $('#product-voting #product-rating-marks-label').text();
        const rating = $('#product-voting #rate').text();
        const authorsList = [];
        authors.map((index, element) => {
          authorsList.push($(element).text());
        })
        const fullAnnotation = $('#product-about #fullannotation p').text();
        const annotation = $('#product-about > p').text();
        downloadImage(imageSrc).then(data => {
          const bookInfo = {
            title: bookTitle,
            category,
            coverPath: data,
            authorsList,
            annotation: fullAnnotation || annotation,
            isbn,
            pages,
            publisher,
            year: getNumbersFromString(year)[0],
            votesCount: getNumbersFromString(votesCount)[0],
            rating: parseFloat(rating)
          }
          resolve(bookInfo);
        })
        .catch(error => console.log(error));
      })
      .catch(error => console.log(error));
  });

}

const downloadImage = async imageSrc => {
  try {
    const response = await axios({
      url: imageSrc,
      method: 'GET',
      responseType: 'stream'
    })

    const coversFolder = path.resolve(__dirname, imagesFolderName);

    if (!fs.existsSync(coversFolder)){
      fs.mkdirSync(coversFolder);
    }

    fs.readdir(coversFolder, (error, files) => {
      if (files.length + 1 === limitImagesInFolder) {
        imagesFolderName = `${rootImagesFolderName}/${shortid.generate()}`;
      }
    });

    const imageTitle = `${shortid.generate()}.${getImageType(response.headers)}`;
    const _path = path.resolve(__dirname, imagesFolderName, imageTitle)
    const writer = fs.createWriteStream(_path)

    response.data.pipe(writer)

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(`${imagesFolderName}/${imageTitle}`))
      writer.on('error', reject)
    })
  } catch (error) {
    console.log(error);
  }
}

const connectMongoDb = () => {
  // Create a new MongoClient
  const client = new MongoClient(mongoDbUrl, { useUnifiedTopology: true });

  // Use connect method to connect to the Server
  client.connect((err) => {
    console.log("Connected successfully to server");

    const db = client.db(dbName);

    startScrapping(db, client);

  });
}

const insertDocument = (db, query) => {
  // Get the documents collection
  const collection = db.collection(collectionName);
  // Insert some documents
  return new Promise(resolve => {
    collection.insertOne(query, (err, result) => {
      resolve(true);
    });
  });
}

connectMongoDb();
