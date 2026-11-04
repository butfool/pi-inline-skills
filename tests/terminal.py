import time

import pexpect
import pyte


class PiTerminal:
    def __init__(self, mode, extra_args=()):
        self.screen = pyte.Screen(140, 45)
        self.stream = pyte.Stream(self.screen)
        self.process = pexpect.spawn(
            "pi",
            ["--no-session", "--offline", "--tui-mode", mode, *extra_args],
            encoding="utf-8",
            dimensions=(45, 140),
            timeout=90,
        )
        self.checks = 0

    def capture(self, seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            try:
                data = self.process.read_nonblocking(65536, timeout=0.1)
            except pexpect.TIMEOUT:
                continue
            self.stream.feed(data)
        return "\n".join(self.screen.display)

    def wait_for(self, predicate, timeout=60):
        deadline = time.monotonic() + timeout
        text = ""
        while time.monotonic() < deadline:
            text = self.capture(0.2)
            if predicate(text):
                return text
        raise AssertionError("Terminal expectation timed out:\n" + text)

    def check(self, condition, text):
        assert condition, text
        self.checks += 1

    def clear_input(self):
        self.process.send("\x03")
        self.capture(0.3)

    def test_completion(self):
        self.process.send("请使用 $find-do")
        text = self.wait_for(lambda text: "find-docs" in text)
        self.check("Retrieves up-to-date documentation" in text, text)
        self.process.send("\t")
        text = self.wait_for(
            lambda text: "请使用 $find-docs" in text and "Retrieves up-to-date" not in text
        )
        self.check("请使用 $find-docs" in text, text)
        self.clear_input()

    def test_empty_marker_lists_every_skill(self):
        self.process.send("请使用 $")
        text = self.wait_for(lambda text: "auto-research" in text and "(1/" in text)
        self.check("Automatic web research workflow" in text, text)
        self.clear_input()

    def test_fuzzy(self):
        self.process.send("请使用 $docs")
        text = self.wait_for(lambda text: "find-docs" in text)
        self.check("请使用 $docs" in text, text)
        self.process.send("\t")
        text = self.wait_for(lambda text: "请使用 $find-docs" in text)
        self.check("请使用 $find-docs" in text, text)
        self.clear_input()

    def test_marker_blocks_file_completion(self):
        # No skill matches, so the popup stays closed instead of falling through
        # to path completion.
        self.process.send("请使用 $zzzz")
        self.wait_for(lambda text: "请使用 $zzzz" in text, timeout=10)
        text = self.capture(0.6)
        self.check("skills/find-docs" not in text, text)
        self.check("(1/" not in text, text)
        self.clear_input()

    def test_reload(self):
        self.process.send("/reload\r")
        self.wait_for(lambda text: "Reloaded" in text)
        self.process.send("请使用 $doc")
        text = self.wait_for(lambda text: "find-docs" in text)
        self.check("find-docs" in text, text)
        self.clear_input()


for mode in ["fullscreen", "regular"]:
    terminal = PiTerminal(mode)
    try:
        terminal.wait_for(lambda text: "❯" in text)
        terminal.test_completion()
        terminal.test_empty_marker_lists_every_skill()
        terminal.test_fuzzy()
        terminal.test_marker_blocks_file_completion()
        terminal.test_reload()
        print(f"Passed {terminal.checks} completion assertions in {mode} mode.")
    finally:
        terminal.process.terminate(force=True)

# Submitting starts a model turn, so each marker shape gets a fresh process that
# is stopped as soon as the skill card is on screen.
for mode in ["fullscreen", "regular"]:
    checks = 0
    for marker, name in [("请使用$find-docs", "find-docs"), ("请使用/skill:simplify", "simplify")]:
        terminal = PiTerminal(mode, ("--no-tools",))
        try:
            terminal.wait_for(lambda text: "❯" in text)
            terminal.process.send(marker)
            terminal.wait_for(lambda text: marker in text)
            terminal.process.send("\r")
            text = terminal.wait_for(
                lambda text: f"Skill {name}" in text, timeout=90
            )
            assert f"Skill {name}" in text, text
            assert marker in text, text
            checks += 1
        finally:
            terminal.process.terminate(force=True)
    print(f"Passed {checks} submission assertions in {mode} mode.")
