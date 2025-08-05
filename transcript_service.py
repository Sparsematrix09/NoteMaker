from flask import Flask, request, jsonify
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route('/transcript', methods=['GET'])
def get_transcript():
    video_id = request.args.get('videoId')
    if not video_id:
        return jsonify({'error': 'Missing video ID'}), 400

    try:
        api = YouTubeTranscriptApi()
        transcript_list = api.list(video_id)

        # Try to find 'en-US' first (manual English transcript)
        try:
            transcript = transcript_list.find_transcript(['en-US'])
        except NoTranscriptFound:
            # Fallback: try 'en' or 'ko'
            try:
                transcript = transcript_list.find_transcript(['en'])
            except NoTranscriptFound:
                transcript = transcript_list.find_transcript(['ko'])

        fetched = transcript.fetch()
        full_text = ' '.join([t.text for t in fetched])  # Use attribute access here
        return jsonify({'transcript': full_text})

    except TranscriptsDisabled:
        return jsonify({'error': 'Transcripts are disabled for this video.'}), 404
    except NoTranscriptFound:
        return jsonify({'error': 'No transcript found for this video.'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(port=5001)
