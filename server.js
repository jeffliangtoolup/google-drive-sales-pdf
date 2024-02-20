const fs = require('fs');
var express = require('express');
var app = express();
app.use(express.static('public'));
app.use(express.json({ limit: '100mb' }))
var post = null;
const {google} = require('googleapis');
const drive = google.drive('v3');
var counter = 0;
const {Readable} = require('stream');

app.get('/', function(req,res){
	res.send('works');
});

app.get('/files', async function(req,res) {
	try {
		var access = getKeyFromHeader(req.headers);
		var auth = getAuthorize(access);

		var files = [];
		var nextPageToken = req.headers.nextPageToken || null;
		var pageCount = parseFloat(req.headers.count) || 100;
		var query = req.headers.query;
		var fields = req.headers.fields;
		
		do {
			var pageSize = Math.min(100, pageCount);
			var currFiles = await listFiles(auth, query, nextPageToken, pageSize, fields);
			if (currFiles.err) {
				res.send({code: 404, status: 'error', message: err});
				return;
			}
			pageCount -= 100;
			files = files.concat(currFiles.files);
			nextPageToken = currFiles.nextPageToken;
		} while (nextPageToken && pageCount > 0);
		
		res.send({code: 200, status: 'success', data: {files: files, nextPageToken: nextPageToken}});
		
	} catch (e) {
		res.send({code: 404, status: 'error', message: e});
	}
})


app.get('/download', function (req, res) {
	
	var access = getKeyFromHeader(req.headers);
	var auth = getAuthorize(access);

	post = res;
	
	download(auth, req.headers.fileid);
})

function download(auth, fileId) {
	const drive = google.drive({version: 'v3', auth});
	drive.files.get({fileId: fileId, alt: 'media'}, {responseType: 'stream'},
    function(err, res){
		console.log("DOWNLOADING FILE")
		if (err) {
			console.error('The API returned an error: ' + err);
			res.send({code: 404, status: 'error', message: 'An error has occurred: ' + err});
			return;
		}
		var chunks = [];
			res.data
			.on('data', function(chunk) {
				chunks.push(chunk);
			})
			.on('end', () => {
				var result = Buffer.concat(chunks);
				var base64 = result.toString('base64');
				post.send({code: 200, status: 'success', data: result.toString()});

			})
			.on('error', err => {
				console.log('Error', err);
				res.send({code: 404, status: 'error', message: 'An error has occurred: ' + err});
			})
		}
	);
}

function getKeyFromHeader(headers) {
	var client_email = headers.client_email;

	//couldn't send \n
	var private_key = headers.private_key;
	
	private_key = private_key.split('?').join('\n');
	
	return {client_email: client_email, private_key: private_key};
}

function getAuthorize(credentials) {
  const jwtClient = new google.auth.JWT(
	  credentials.client_email,
	  null,
	  credentials.private_key,
	  ['https://www.googleapis.com/auth/drive'],
	  null
	);
	return jwtClient;
}

function listFiles(auth, query, nextPageToken, pageSize = 100, fields) {
	const drive = google.drive({version: 'v3', auth});
	
	return new Promise(function (resolve, reject) {
		drive.files.list({
			pageSize: pageSize,
			fields: fields,
			q: query,
			orderBy: 'modifiedTime desc',
			pageToken: nextPageToken
		}, (err, res, req) => {
			if (err) {
				console.log('The API returned an error: ' + err);
				reject({err: err, files: null});
			}
			const nextPageToken = res.data.nextPageToken;
			var files = res.data.files;
			resolve({files: files, nextPageToken: nextPageToken});
		});
	});
}
/*

function getAuth() {
	return new Promise(function (resolve, reject) {
		fs.readFile('./creds.json', function read(err, data) {
			if (err) {
				reject(err);
			}
			
			var creds = JSON.parse(data);
			
			var access = {client_email: creds.client_email, private_key: creds.private_key};
		
			var auth = getAuthorize(access);
			
			resolve(auth);
		})
	})
}
async function test() {
	var auth = await getAuth();
	
	var nextPageToken = null;
	var files = [];
	var query = "'1QKXKvEOLb_jWhWgJqT36pY-slQTfg2ng' in parents"
	var fields = 'nextPageToken, files(id, name, modifiedTime)';
	var pageCount = Number.MAX_VALUE;
	do {
		var pageSize = Math.min(100, pageCount);
		var currFiles = await listFiles(auth, query, nextPageToken, pageSize, fields);
		if (currFiles.err) {
			res.send({code: 404, status: 'error', message: err});
			return;
		}
		pageCount -= 100;
		files = files.concat(currFiles.files);
		nextPageToken = currFiles.nextPageToken;
	} while (nextPageToken && pageCount > 0);
	
	var info = download(auth, '1M7SNWLRNd1oFDLvXLNAk_aNDmyKEEtPR');
}
test();

*/

app.post('/receiptimages', async (req, res) => {
	try {
		const { auth, sharedDriveId, itemReceiptName, files } = req.body;

		const driveService = await authenticateGoogleDrive(auth.client_email, auth.private_key);

		const folderId = await createFolder(driveService, itemReceiptName, sharedDriveId);


		const uploadPromises = files.map(fileData => {
			const mimeType = getMimeType(fileData.fileType);

			return uploadBase64File(
				driveService,
				folderId,
				fileData.content,
				fileData.fileName,
				mimeType,
				sharedDriveId
			);
		});

		const uploadedFileIds = await Promise.all(uploadPromises);

		res.json({
			code: 200,
			status: 'success',
			message: 'All files uploaded successfully to folder: ' + itemReceiptName,
			uploadedFileIds: uploadedFileIds
		});
	} catch (error) {
		console.error('Error:', error);
		res.status(500).json({ code: 500, status: 'error', message: 'Failed to upload files' });
	}
});

async function authenticateGoogleDrive(client_email, private_key) {
	const auth = new google.auth.JWT(
		client_email,
		null,
		private_key.replace(/\\n/g, '\n'),
		['https://www.googleapis.com/auth/drive'],
		null
	);
	return google.drive({ version: 'v3', auth });
}

async function createFolder(driveService, itemReceiptName, sharedDriveId) {
	const fileMetadata = {
		'name': itemReceiptName,
		'mimeType': 'application/vnd.google-apps.folder',
		'parents': [sharedDriveId],
		'driveId': sharedDriveId,
	};
	const folder = await driveService.files.create({
		resource: fileMetadata,
		fields: 'id',
		supportsAllDrives: true,
	});
	return folder.data.id;
}

function getMimeType(fileType) {
	const mimeTypes = {
		'JPGIMAGE': 'image/jpeg',
		'GIFIMAGE': 'image/gif',
		'PNGIMAGE': 'image/png',
		'SVG': 'image/svg+xml',
		'TIFFIMAGE': 'image/tiff',
		'ICON': 'image/x-icon', // Assuming these are favicon.ico files. Adjust if different.
	};
	return mimeTypes[fileType] || 'application/octet-stream'; // Default MIME type
}

async function uploadBase64File(driveService, folderId, base64Content, fileName, mimeType) {
	const decodedContent = Buffer.from(base64Content, 'base64');

	const mediaStream = await bufferToStream(decodedContent);

	const fileMetadata = {
		'name': fileName,
		'mimeType': mimeType,
		'parents': [folderId],
	};

	const media = {
		mimeType: mimeType,
		body: mediaStream
	};
	console.log(media)

	const file = await driveService.files.create({
		requestBody: fileMetadata,
		media: media,
		fields: 'id',
		supportsAllDrives: true,
	});

	return file.data.id;
}

function bufferToStream(buffer) {
	return new Promise((resolve, reject) => {
		const stream = new Readable();
		stream.push(buffer);
		stream.push(null);
		resolve(stream);
	});
}


var listener = app.listen(process.env.PORT, function() {
	console.log('Your app is listening on port ' + listener.address().port);
})

