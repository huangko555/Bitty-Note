class UserVisibleError(RuntimeError):
    """An expected error that can be shown to the user without a traceback."""


class NoteNotFoundError(UserVisibleError):
    """A missing note, distinct from temporary access and decoding errors."""
