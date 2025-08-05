require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const Note = require('./models/Note.js');
const HUGGING_FACE_API_URL = 'https://api-inference.huggingface.co/models/facebook/bart-large-cnn';

const app = express();
const port = 3000;

// Set view engine and public directory
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("MongoDB connection error:", err));



// Multer setup for image uploads
const uploadPath = path.join(__dirname, 'public/uploads');
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadPath),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });



// Home Page
app.get('/', async (req, res) => {
    const search = req.query.search || '';
    try {
        const notes = await Note.find({
            title: { $regex: search, $options: 'i' }
        }).sort({ updatedAt: -1 });

        const withPreviews = notes.map(note => ({
            ...note._doc,
            preview: note.content?.slice(0, 150) || ''
        }));

        res.render('index', { notes: withPreviews, searchQuery: search });
    } catch (err) {
        res.status(500).send('Error loading notes.');
    }
});

// Create Note Page
app.get('/create', (req, res) => {
    res.render('create');
});

// Create New Note with optional image and reminder
app.post('/create', upload.single('image'), async (req, res) => {
    const { title, details, reminderAt } = req.body;
    const image = req.file ? `/uploads/${req.file.filename}` : null;

    try {
        await Note.create({
            title: title.trim(),
            content: details,
            image,
            reminderAt: reminderAt ? new Date(reminderAt) : null
        });
        res.redirect('/');
    } catch (err) {
        console.error('Error creating note:', err);
        res.status(500).send('Error creating note.');
    }
});

// Read Note Page
app.get('/read/:id', async (req, res) => {
    try {
        const note = await Note.findById(req.params.id);
        if (!note) return res.status(404).send('Note not found');

        res.render('read', {
            filename: note.title + ".txt",
            content: note.content,
            image: note.image,
            reminderAt: note.reminderAt
        });
    } catch {
        res.status(500).send('Error reading note.');
    }
});

// Edit Note Page
app.get('/edit/:id', async (req, res) => {
    try {
        const note = await Note.findById(req.params.id);
        if (!note) return res.status(404).send('Note not found');
        res.render('edit', { note });
    } catch {
        res.status(500).send('Error loading edit page.');
    }
});

// Handle Note Edit
app.post('/edit/:id', upload.single('image'), async (req, res) => {
    const { title, details, reminderAt, oldImage } = req.body;
    const image = req.file ? `/uploads/${req.file.filename}` : oldImage;

    try {
        await Note.findByIdAndUpdate(req.params.id, {
            title: title.trim(),
            content: details,
            image,
            reminderAt: reminderAt || null,
            updatedAt: new Date()
        });
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating note.');
    }
});

// Delete Note
app.post('/delete/:id', async (req, res) => {
    try {
        const note = await Note.findById(req.params.id);
        if (!note) return res.status(404).send('Note not found');

        if (note.image) {
            const imagePath = path.join(__dirname, note.image);
            fs.unlink(imagePath, (err) => {
                if (err) console.error('Error deleting image:', err);
            });
        }

        await Note.findByIdAndDelete(req.params.id);
        res.redirect('/');
    } catch {
        res.status(500).send('Error deleting note.');
    }
});

// Summarize Note using HuggingFace API
app.post('/summarize/:id', async (req, res) => {
    try {
        const note = await Note.findById(req.params.id);
        const response = await axios.post(
            'https://api-inference.huggingface.co/models/facebook/bart-large-cnn',
            { inputs: note.content },
            {
                headers: {
                    Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`
                }
            }
        );

        const summary = response.data[0]?.summary_text || 'No summary available.';
        res.render('summary', { summary });
    } catch (error) {
        res.status(500).send('Failed to summarize note.');
    }
});
app.get('/notes/:id/download-pdf', async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).send('Note not found');

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${note.title}.pdf"`);

    // Create a PDF document
    const doc = new PDFDocument();
    doc.pipe(res);

    doc.fontSize(20).text(note.title, { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(note.content);

    doc.end();
  } catch (err) {
    res.status(500).send('Server error');
  }
});

function extractVideoId(url) {
  const regex = /(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

app.post('/youtube-summarize', async (req, res) => {
  const { url } = req.body;
  const videoId = extractVideoId(url);

  if (!videoId) {
    return res.status(400).send("Invalid YouTube URL");
  }

  try {
    // Get transcript from Flask server
    const response = await axios.get("http://localhost:5001/transcript", {
      params: { videoId }
    });

    const transcript = response.data.transcript;

    // Summarize using Hugging Face
    const hfSummary = await axios.post(
      HUGGING_FACE_API_URL,
      { inputs: transcript.slice(0, 2000) },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`
        }
      }
    );

    const summary = hfSummary.data[0]?.summary_text || "No summary returned";
    res.render("summary", { summary });

  } catch (err) {
    console.error("Error during summarization:", err.message);
    res.status(500).send("Summarization failed");
  }
});




// Start Server
app.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
});
