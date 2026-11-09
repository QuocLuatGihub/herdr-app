import importlib.util
from pathlib import Path
import tempfile
import unittest
import wave
spec = importlib.util.spec_from_file_location('voice', Path(__file__).parents[1] / 'custom/voice/voice.py')
voice = importlib.util.module_from_spec(spec)
spec.loader.exec_module(voice)

class VoiceTests(unittest.TestCase):
    def test_reject_path_traversal(self):
        for name in ('../secrets', '/tmp/test', '', 'x;rm'):
            with self.assertRaises(ValueError):
                voice.job_dir(name)

    def test_silence_is_rejected_before_recognition(self):
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp)/'silence.wav'
            with wave.open(str(wav),'wb') as f:
                f.setparams((1,2,16000,0,'NONE','not compressed'))
                f.writeframes(b'\0'*32000)
            self.assertFalse(voice.has_speech(wav))

if __name__ == '__main__':
    unittest.main()
