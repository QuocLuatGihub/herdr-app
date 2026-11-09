import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('status',Path(__file__).parents[1]/'custom/agents/status.py')
status=importlib.util.module_from_spec(spec);spec.loader.exec_module(status)

class StatusTests(unittest.TestCase):
    def test_real_runtime_states_and_approvals(self):
        self.assertEqual(status.state({'type':'active','activeFlags':[]}), 'working')
        for flag in ('waitingOnApproval','waitingOnUserInput'):
            self.assertEqual(status.state({'type':'active','activeFlags':[flag]}),'blocked')
        self.assertEqual(status.state({'type':'idle'}),'idle')
        self.assertIsNone(status.state({'type':'notLoaded'}))

    @patch.object(status,'screen_cwds',return_value={'/project'})
    def test_ambiguous_threads_are_not_guessed(self,_):
        threads=[dict(id=str(i),cwd='/project',status={'type':'idle'}) for i in (1,2)]
        self.assertEqual(status.match({},threads)['status'],'unknown')
        self.assertEqual(status.match({'labels':{'custom.codex.thread':'2'}},threads)['threadId'],'2')
        self.assertEqual(status.match({},[dict(id='3',cwd='/other',status={'type':'active'})])['status'],'unknown')

    def test_client_cannot_send_mutating_rpc(self):
        daemon=status.Daemon.__new__(status.Daemon)
        with self.assertRaises(ValueError):
            daemon.request('turn/start',{})

if __name__=='__main__':unittest.main()
