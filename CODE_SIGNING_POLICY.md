# Code signing policy

## Status

Bitty-Note's application to the SignPath Foundation open-source code-signing program was not approved. The project does not currently have a third-party code-signing certificate.

GitHub release artifacts are therefore unsigned unless a future release explicitly states otherwise. Windows may display an unknown-publisher or SmartScreen warning. Official GitHub releases provide SHA-256 checksums so users can verify downloaded files.

Microsoft Store packages follow the Store submission and signing process. Trust applied to a Store package does not sign or transfer to the separate GitHub portable build.

## Scope

Only official Bitty-Note release artifacts built from this repository may be submitted to a signing provider or Microsoft Store. Third-party binaries are not represented as if they were produced by Bitty-Note.

## Team roles

- **Committer and reviewer:** [@huangko555](https://github.com/huangko555), the Bitty-Note maintainer.
- **Approver:** [@huangko555](https://github.com/huangko555), the Bitty-Note repository owner.

Changes from contributors without write access must be reviewed before they are merged. Each official release requires manual approval by the approver.

## Build and release controls

- Official GitHub artifacts must be produced by the public Windows build workflow in `.github/workflows/build-windows.yml` from a tagged source revision.
- Microsoft Store packages must be built from the same reviewed source revision and use the identity assigned in Partner Center.
- Product name and version metadata must match the release being signed.
- Build scripts and release workflows are reviewed as security-sensitive code.
- Repository and signing-service accounts used for releases must have multi-factor authentication enabled.
- Signing credentials are managed by the signing service and are not stored in this repository.

## Privacy

Bitty-Note's network behavior and data handling are described in the [Privacy Policy](./PRIVACY.md).
