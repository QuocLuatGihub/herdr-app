# Herdr Custom Voice (macOS)

This personal mod adds Vietnamese/English dictation and user-triggered read-aloud
without changing Herdr's model, commands, shared APIs, or core.

Install: `bash scripts/setup-voice-macos`. It is also called by
`scripts/install-macos-custom`. Activate with
`herdr-custom do layout.switch '{"name":"voice-custom"}'`.

Toggle the Voice sidebar with Cmd+Option+V or the persistent button at the
bottom right. The panel header also has a Hide button.

Select a live terminal in the Voice panel, choose Vietnamese/English/automatic,
click Enable microphone (or Cmd+Shift+V). Text appears in batches while you speak.
Recording ends after about two seconds of silence after speech (or ten seconds
without speech). Stop is optional. The first recording asks for microphone
permission; macOS may attribute this to Herdr Core because it launches the helper.
Check System Settings > Privacy & Security > Microphone if access is denied.
Read and edit the transcript, then explicitly click Send. Send can also be clicked
while recording: it ends capture, waits for final recognition, then delivers once.
An ASR error never sends a partial transcript. Edits to partial text are preserved. Target selection is
locked while recording, transcribing, or delivering. Changing terminal focus does
not change the selected voice target. Text sent to a shell is shell input; select
your agent terminal when giving it a task. No automatic approval bypass is used.

Get response reads the selected terminal's current screen (no history scrolling),
including CLI chrome. Edit the read-aloud preview to keep just the response you
want, then click Read content. Stop reading interrupts only this panel's speech
process. This is not automatic response extraction or a manager agent.

Whisper.cpp small-q5_1 (multilingual, pinned SHA256) runs locally. Linh, a macOS
voice, reads Vietnamese locally. No audio or transcript goes to an external speech
API. Sending a reviewed transcript to Codex still uses the agent's normal provider.
Audio is stored in private job folders under `~/.local/share/herdr-voice/jobs` and
removed after recognition, including recognition errors. Abrupt process termination
or power loss may leave a job folder; no raw audio is written to Git.

The first partial result requires a few seconds of audio plus local decoding;
this is periodic preview, not instant word-by-word recognition. Recording is limited to 60 seconds. The mod does not start recording or speaking
on its own. Closing the panel cancels its recording and speech. Voice requires the
Mac to stay on, even when the selected terminal is remote. Remote terminals appear
when their machine has been added to this Custom core session.

Tests: `bun test scripts/voice.test.ts`,
`python3 -m unittest discover -s scripts -p test_voice.py`, and
`herdr-custom check custom/voice/mod`.
