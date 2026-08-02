from __future__ import annotations

from desktop_notes.main import _normalize_window_after_show


class FakeEvent:
    def __init__(self) -> None:
        self.handlers: list[object] = []

    def __iadd__(self, handler: object) -> "FakeEvent":
        self.handlers.append(handler)
        return self


class FakeEvents:
    def __init__(self) -> None:
        self.moved = FakeEvent()
        self.resized = FakeEvent()


class FakeWindow:
    def __init__(self) -> None:
        self.events = FakeEvents()
        self.resize_calls: list[tuple[int, int]] = []

    def resize(self, width: int, height: int) -> None:
        assert self.events.moved.handlers == []
        assert self.events.resized.handlers == []
        self.resize_calls.append((width, height))


class FakeStateSaver:
    def schedule(self) -> None:
        pass


def test_initial_size_is_normalized_before_state_tracking_starts() -> None:
    window = FakeWindow()
    saver = FakeStateSaver()

    _normalize_window_after_show(window, saver, 350, 630)

    assert window.resize_calls == [(350, 630)]
    assert window.events.moved.handlers == [saver.schedule]
    assert window.events.resized.handlers == [saver.schedule]
