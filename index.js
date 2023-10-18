const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const shortid = require('shortid');
const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const bookSchema = new Schema({
  title: String,
  categoryPath: String,
  coverPath: String,
  authorsList: [String],
  annotation: String,
  pages: Number,
  votesCount: Number,
});

const Book = mongoose.model('Book', bookSchema);
const V2_book = mongoose.model('V2_book', bookSchema);

// TODO: 
// 1. package scripts with parameters
// 2. build for prod and dev
// 3. reconnect if error happens
// 4. refactoring

const dbName = 'bookstracker';
const mongoDbUrl = `mongodb://admin:JDASD&#ASDgsdds@185.12.94.36:27017/${dbName}?authSource=admin&readPreference=primary&appname=MongoDB%20Compass&ssl=false`;
const collectionName = 'books';

const baseUrl = "https://www.chitai-gorod.ru";
// ID категории
const categoryPath = '0.0.0'
// страница с которой начинать (по умолчанию 1)
let currentCategoryPage = 1;
// страница на которой заканчивать
let lastCategoryPage = 2;

//взять из урла на labirint.ru
const genreId = 'catalog/books/psihologiya-biznesa-psihologiya-uspekha-karera-biznes-ehtiket-110363';
let initialCategoryUrl = `${baseUrl}/${genreId}`;
let fullCategoryUrl;

const limitImagesInFolder = 500; //by default = 500
const imagesFolderNamePrefix = 'images';
let imagesFolderName = `${categoryPath}_${shortid.generate()}`;

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
        const bookItems = $('.catalog-list .products-list article.product-card');
        const books = bookItems.map(async (index, element) => {
          if (limitBooksOnPage(true, index)) {
            try {
              const href = $(element).find('a.product-card__picture').attr('href');
              const detailUrl = `${baseUrl}${href}`;
              const bookTitle = $(element).find('.product-title__head').text().trim();

              const bookExists = await Book.findOne({ title: bookTitle }).collation( { locale: 'ru', strength: 2 } );
              console.log(bookExists, 'bookExists');
              if (!bookExists) {
                detailUrls.push({ bookTitle, detailUrl });
              }
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
        const imageSrc = $('img.product-gallery__image').attr('src');
        const authors = $('a[itemprop="author"]');
        const pages = $('span[itemprop="numberOfPages"]').text();
        const votesCount = $('.product-detail-rating span[itemprop="reviewCount"]').text();
        const authorsList = [];
        authors.map((index, element) => {
          const author = $(element).text().trim();
          if (author) {
            authorsList.push(author);
          }
        })
        const fullAnnotation = $('div[itemprop="description"]').text().trim();
        // const annotation = $('#product-about > p').text();
        downloadImage(imageSrc).then(data => {
          const bookInfo = {
            title: bookTitle.trim(),
            categoryPath,
            coverPath: data,
            authorsList,
            annotation: fullAnnotation,
            pages: Number(pages),
            votesCount
          }
          console.log('book');
          resolve(bookInfo);
        })
          .catch(error => console.log(error));
      })
      .catch(error => {
        // if error to go next
        if (currentDetailUrlIndex < detailUrls.length) {
          currentDetailUrlIndex = currentDetailUrlIndex + 1;
          saveBooks();
        }
        console.log(error);
      });
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

    if (!fs.existsSync(coversFolder)) {
      fs.mkdirSync(coversFolder);
    }

    fs.readdir(coversFolder, (error, files) => {
      if (files.length + 1 === limitImagesInFolder) {
        imagesFolderName = `${categoryPath}_${shortid.generate()}`;
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

const updateBooks = async () => {
  const res = await Book.updateMany({}, [
    { $set: { categoryPath: { $concat: ['$categoryId', '.', '$categoryLevel1Id', '.', '$categoryLevel2Id'] } } },
    { $unset: ['categoryId', 'categoryLevel1Id', 'categoryLevel2Id'] }
  ]);
  console.log(res, 'res');
}

// const updateCoverPath = async () => {
//   const res = await Book.updateMany({}, [
//     {$set: { coverPathWebp: { $substr: [ "$coverPathWebp", 0, { $add: [ { $strLenCP: "$coverPathWebp" }, -4 ] } ]}} }
//   ]);
//   console.log(res, 'res');
// }

// const updateCoverPath = async () => {
//   const res = await Book.updateMany({}, [
//     {$set: { coverPath: {$arrayElemAt:[{$split:["$coverPath", "."]}, 0]}} }
//   ]);
//   console.log(res, 'res');
// }

// const updateCoverPath = async () => {
//   const res = await Book.updateMany({}, [
//     {$set: { coverPathWebp: '213123140asdjasd.jpg'} }
//   ]);
//   console.log(res, 'res');
// }

const removeDuplicates = async () => {
  const duplicates = [];
  // const res = await Book.aggregate([
  //   {"$match": {"title" :{ "$ne" : null } } },
  //   {"$group" : {"_id": "$title", dups: { "$addToSet": "$_id" }, "count": { "$sum": 1 } } },
  //   {"$match": {"count" : {"$gt": 1} } },
  //   {"$project": {"title" : "$_id", "_id" : 0} }
  // ],
  // {allowDiskUse: true}       // For faster processing if set is larger
  // )               // You can display result until this and check duplicates 
  // .forEach(function(doc) {
  //     doc.dups.shift();      // First element skipped for deleting
  //     doc.dups.forEach( function(dupId){ 
  //         duplicates.push(dupId);   // Getting all duplicate ids
  //         }
  //     )
  // });
  const res = await Book.aggregate([
    { $group: { _id: "$title", dups: { $push: "$_id" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]);
  res.forEach(async function(doc){
    doc.dups.shift();
    await Book.deleteMany({_id : {$in: doc.dups}});
  });
  console.log(res, 'res');
}

const connectMongoDb = () => {
  console.log(new Date(), 'start');
  mongoose.connect(mongoDbUrl, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 5000 });
  var db = mongoose.connection;
  db.on('error', console.error.bind(console, 'connection error:'));
  db.on('connected', async () => {
    console.log('Connected to mongoDb');
    // updateCoverPath();
    startScrapping();
    // removeDuplicates();
  });
}

connectMongoDb();
