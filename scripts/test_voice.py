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

class StreamingTests(unittest.TestCase):
    def test_merge_only_finalized_chunks_in_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            chunks=[]
            for i in (1,2):
                chunk=root/f'chunk-{i:03d}.wav'
                with wave.open(str(chunk),'wb') as f:
                    f.setparams((1,2,16000,0,'NONE','not compressed'))
                    f.writeframes(bytes([i,0])*160)
                chunks.append(chunk)
            voice.merge_chunks(chunks,root/'preview.wav')
            with wave.open(str(root/'preview.wav')) as f:
                self.assertEqual(f.getnframes(),320)
                self.assertEqual(f.readframes(320),bytes([1,0])*160+bytes([2,0])*160)
            voice.publish(root,ready=True,text='kiểm tra')
            import json
            self.assertEqual(json.loads((root/'status.json').read_text())['text'],'kiểm tra')

if __name__ == '__main__':
    unittest.main()
