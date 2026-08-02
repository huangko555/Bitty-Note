# Code signing policy

## Status

Bitty-Note is preparing an application for the SignPath Foundation open-source code-signing program. Until that application is approved and the release workflow is connected, release files may be unsigned.

Planned provider: **Free code signing provided by SignPath.io, certificate by SignPath Foundation**.

## Scope

Only official Bitty-Note release artifacts built from this repository may be submitted for signing. Third-party binaries are not signed as if they were produced by Bitty-Note.

## Team roles

- **Committer and reviewer:** [@huangko555](https://github.com/huangko555), the Bitty-Note maintainer.
- **Approver:** [@huangko555](https://github.com/huangko555), the Bitty-Note repository owner.

Changes from contributors without write access must be reviewed before they are merged. Each signing request requires manual approval by the approver.

## Build and release controls

- Signed artifacts must be produced by the public Windows build workflow in `.github/workflows/build-windows.yml` from a tagged source revision.
- Product name and version metadata must match the release being signed.
- Build scripts and release workflows are reviewed as security-sensitive code.
- Repository and signing-service accounts used for releases must have multi-factor authentication enabled.
- Signing credentials are managed by the signing service and are not stored in this repository.

## Privacy

Bitty-Note's network behavior and data handling are described in the [Privacy Policy](./PRIVACY.md).
