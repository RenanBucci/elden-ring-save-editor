use er_save::{open_bytes, apply_with, ApplyRequest, WritePolicy};
#[test]
fn malformed_input_is_rejected_without_panicking() {
    for bytes in [&b""[..], &b"BND4"[..], &b"not a save"[..], &[0; 128][..]] {
        assert!(open_bytes(bytes).is_err());
        assert!(apply_with(bytes, &ApplyRequest::default(), WritePolicy::default()).is_err());
    }
}
