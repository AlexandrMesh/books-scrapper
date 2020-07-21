const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const shortid = require('shortid');
const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const bookSchema = new Schema({
  title: String,
  categoryId: Number,
  coverPath: String,
  authorsList: [String],
  annotation: String,
  isbn: String,
  pages: String,
  publisher: String,
  year: Number,
  votesCount: Number,
  rating: Number
});

const Book = mongoose.model('Book', bookSchema);

// TODO: 
// 1. package scripts with parameters
// 2. build for prod and dev
// 3. reconnect if error happens
// 4. refactoring

const dbName = 'bookstracker';
const mongoDbUrl = `mongodb://admin:JDASD&#ASDgsdds@185.12.94.36:27017/${dbName}?authSource=admin&readPreference=primary&appname=MongoDB%20Compass&ssl=false`;
const collectionName = 'books';

const baseUrl = "https://www.labirint.ru";
const categoryId = 1;
let currentCategoryPage = 5;
let lastCategoryPage = 7;
const genreId = 2304;
let initialCategoryUrl = `${baseUrl}/genres/${genreId}`;
let fullCategoryUrl;

const limitImagesInFolder = 500; //by default = 500
const imagesFolderNamePrefix = 'images';
let imagesFolderName = `${shortid.generate()}`;

const imageType = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png'
}

const delay = timeout => {
  return new Promise(resolve => {
    const wait = setTimeout(() => {
      clearTimeout(wait);
      resolve(true);
    }, timeout)
  });
}

const detailUrls = [];
let currentDetailUrlIndex = 0;

const limitBooksOnPage = (isActive = false, index, countBooksOnPage = 1000) => {
  if (!isActive) {
    return true;
  } else if (index < countBooksOnPage) {
    return true;
  } else {
    return false;
  }
}

const getCategoryUrl = () => {
  return fullCategoryUrl;
}

const setCategoryUrl = page => {
  fullCategoryUrl = `${initialCategoryUrl}/?page=${page}`
}

const getImageType = headers => {
  return imageType[headers['content-type']] || imageType['image/jpeg']
}

const getNumbersFromString = string => string.match(/\d+/g).map(Number);

const startScrapping = () => {
  moveToCategoryPage(initialCategoryUrl);
}

const saveBooks = async () => {
  try {
    if (currentDetailUrlIndex === detailUrls.length) {
      mongoose.connection.close();
      console.log(new Date(), 'end');
      return true;
    }
    await delay(1000);
    const detailUrl = detailUrls[currentDetailUrlIndex].detailUrl;
    const bookTitle = detailUrls[currentDetailUrlIndex].bookTitle;
    const bookInfo = await setBookInfo(detailUrl, bookTitle);
    const book = new Book(bookInfo);
    console.log(currentDetailUrlIndex, 'PROCESS');
    console.log(detailUrls.length, 'PROCESS');
    await book.save();
    currentDetailUrlIndex = currentDetailUrlIndex + 1;
    saveBooks();
  } catch (error) {
    console.log(error);
  }
}

const setCategoryPage = () => {
  currentCategoryPage = currentCategoryPage + 1;
  if (currentCategoryPage > lastCategoryPage) {
    console.log(currentCategoryPage, 'page NO');
    saveBooks()
    return true;
  } else {
    setCategoryUrl(currentCategoryPage);
    console.log(currentCategoryPage, 'page YES');
    moveToCategoryPage(getCategoryUrl());
  }
}

const moveToCategoryPage = categoryUrl => {
  axios(categoryUrl)
    .then(async response => {
      try {
        const html = response.data;
        const $ = cheerio.load(html);
        const bookItems = $('.catalog-responsive .products-row > .card-column:not(.responsive-promoblock)');

        const books = bookItems.map(async (index, element) => {
          if (limitBooksOnPage(true, index)) {
            try {
              const href = $(element).find('.product-cover .cover').attr('href') || $(element).find('.b-product-block-link').attr('href');
              const detailUrl = `${baseUrl}${href}`;
              const bookTitle = $(element).find('.product-cover .product-title-link .product-title').text();
              detailUrls.push({ bookTitle, detailUrl });
            } catch (error) {
              console.log(error);
            }
          }
        }).get();

        Promise.all(books).then(() => {
          setCategoryPage();
        });
      } catch (error) {
        console.log(error);
      }
    })
    .catch(error => console.log(error));
};

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
            categoryId,
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
          console.log('book');
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

    const coversFolder = path.resolve(__dirname, `${imagesFolderNamePrefix}/${imagesFolderName}`);

    if (!fs.existsSync(coversFolder)){
      fs.mkdirSync(coversFolder);
    }

    fs.readdir(coversFolder, (error, files) => {
      if (files.length + 1 === limitImagesInFolder) {
        imagesFolderName = `${shortid.generate()}`;
      }
    });

    const imageTitle = `${shortid.generate()}.${getImageType(response.headers)}`;
    const _path = path.resolve(__dirname, `${imagesFolderNamePrefix}/${imagesFolderName}`, imageTitle)
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
  console.log(new Date(), 'start');
  mongoose.connect(mongoDbUrl, {useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 5000});
  var db = mongoose.connection;
  db.on('error', console.error.bind(console, 'connection error:'));
  db.on('connected', async () => {
    console.log('Connected to mongoDb');
    startScrapping();
  });
}

connectMongoDb();
