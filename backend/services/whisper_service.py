import openai
import os
from typing import Optional
from dotenv import load_dotenv

class WhisperService:
    def __init__(self):
        load_dotenv()
        self.client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    async def transcribe_audio(self, audio_file_path: str) -> str:
        """
        Transcribe audio file using OpenAI Whisper API
        
        Args:
            audio_file_path: Path to the audio file
            
        Returns:
            str: Transcribed text
        """
        try:
            with open(audio_file_path, "rb") as audio_file:
                transcript = self.client.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file,
                    response_format="text"
                )
            return transcript
        except Exception as e:
            raise Exception(f"Error transcribing audio: {str(e)}")
    
    async def transcribe_audio_from_bytes(self, audio_bytes: bytes, filename: str) -> str:
        """
        Transcribe audio from bytes using OpenAI Whisper API
        
        Args:
            audio_bytes: Audio file content as bytes
            filename: Original filename
            
        Returns:
            str: Transcribed text
        """
        try:
            # Create a file-like object for Whisper
            import io
            audio_file = io.BytesIO(audio_bytes)
            audio_file.name = filename
            
            print(f"Transcribing audio: {filename}, size: {len(audio_bytes)} bytes")
            
            # Add basic retry logic for network issues
            import time
            max_retries = 2
            
            for attempt in range(max_retries):
                try:
                    transcript = self.client.audio.transcriptions.create(
                        model="whisper-1",
                        file=audio_file,
                        response_format="text"
                    )
                    print(f"Transcription successful: {len(transcript)} characters")
                    return transcript
                except Exception as retry_error:
                    print(f"Whisper API attempt {attempt + 1} failed: {str(retry_error)}")
                    if attempt < max_retries - 1:
                        time.sleep(1 * (attempt + 1))  # Exponential backoff
                        # Reset file pointer for retry
                        audio_file.seek(0)
                    else:
                        raise retry_error
                    
        except Exception as e:
            print(f"Whisper API error: {str(e)}")
            raise Exception(f"Error transcribing audio: {str(e)}")
