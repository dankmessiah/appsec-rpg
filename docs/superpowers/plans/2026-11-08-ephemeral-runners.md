# Ephemeral runner provisioning

Status: private control repository and isolated network provisioning authorized. Credential setup and final runner cutover remain separate steps. The network foundation is being implemented; verify live infrastructure before using proposed identifiers.

## Boundary and execution

Keep the public application repository for source and GitHub-hosted checks. Move LAN-only forwarding and scheduled DAST jobs to a private control repository. Repository-level JIT registration does not reserve a runner for a particular job. Only trusted workflows in the private repository may target the disposable runner labels. Do not execute application PR code on a runner with LAN access.

Use an internal Proxmox bridge with no physical ports, host IP, gateway, or IPv6 link-local address. A separate dual-NIC gateway VM provides DHCP, DNS, an explicit HTTPS proxy, and a narrowly scoped findings relay. This requires no physical router VLAN changes. Exact addresses and VM IDs belong in private deployment configuration, not this public repository.

The gateway starts with 1 vCPU, 1 GiB RAM, and 8 GiB disk. A fresh unprivileged Debian LXC template has 2 vCPU, 4 GiB RAM, and 20 GiB disk. Full clones receive only an internal NIC. Initially permit one active clone. Do not clone the existing persistent runner or include its registration state, SSH host identity, machine identity, or credentials in the template.

## Network policy

- Deny direct internet forwarding, alternate DNS, IPv6, and all LAN access from runner guests by default.
- Permit HTTPS through a destination allowlisted CONNECT proxy. Reject IP-literal requests and DNS resolutions to private, loopback, link-local, CGNAT, multicast, and other nonpublic destinations.
- Allow GitHub runner control, actions, artifact storage, release downloads, and the pinned ZAP image registry domains documented by GitHub. Configure both the runner and Docker to use the proxy. Preload pinned scanner images when practical.
- Expose an internal HTTPS relay that accepts only `POST /webhook/appsec-ingest`, preserves `X-AppSec-Token`, and forwards to a fixed n8n upstream with certificate validation. Do not expose the n8n editor or API to runners.
- Add one exact staging destination IP and TCP port after staging exists. Keep all other LAN destinations blocked. No public inbound forwarding.
- Bind controller management to the management network. The runner-facing gateway interface exposes only the explicitly listed services.

## Controller and credentials

Build the controller in n8n. Poll the private repository rather than publishing a new webhook endpoint. Disable all successful, failed, manual, and progress execution payload saving for token-bearing workflows.

Create a GitHub App installed only on the private control repository, with repository Administration write for JIT registration, Actions read for job polling, and Metadata read. Scope source-repository artifact access separately. Keep the private key and installation tokens in the controller, never in a guest.

Use a dedicated Proxmox user and privilege-separated API token. Apply the same required scopes to the user and token:

| Scope | Privileges |
| --- | --- |
| Template VM | VM.Clone |
| Dedicated runner pool | VM.Allocate, VM.PowerMgmt, VM.Audit; Pool.Audit if enumerating the pool |
| Runner storage | Datastore.AllocateSpace |
| Internal runner bridge | SDN.Use |

Trust the Proxmox cluster CA and validate its existing certificate. Do not grant broad administrator or console access. Poll only tasks created by this token.

Use a fixed authenticated HTTPS bootstrap service with strict TLS, reachable only by n8n. Validate the lease, allowed VMID range, pool membership, and guest identity. Send the one-time JIT configuration through stdin to a fixed root-owned bootstrap command, then run the runner as its unprivileged account. Do not interpolate job content into commands or persist JIT configuration in Proxmox descriptions, command arguments, or saved n8n payloads.

## Lifecycle

1. Atomically claim a queued trusted job. Persist its run attempt, job ID, lease expiry, VMID, clone task, and eventual runner ID in a durable controller ledger.
2. Full-clone the offline template into the dedicated pool. Check task completion before starting it. Verify guest identity and connectivity before generating short-lived registration material.
3. Bootstrap JIT registration and record the actual runner ID. Reconcile the job actually assigned to that runner, not merely the intended queued job.
4. On completion, cancellation, failed bootstrap, or expiry, stop and delete only the lease-verified clone. Remove leftover GitHub registration and retain nonsecret diagnostics outside the guest.
5. Reconcile abandoned leases after controller restart. Retry transient operations idempotently, with a bounded expiry and one active clone limit.

## Rollout and proof

- Back up host network configuration before adding the isolated bridge. Do not alter the existing management bridge or default route. Have console access and a rollback path before network changes.
- From a disposable guest, prove denial of Proxmox management, n8n editor/API, other LAN destinations, direct internet, alternate DNS, and IPv6. Prove the allowed proxy, fixed ingest relay, and staging exception individually.
- Complete two consecutive private-repository jobs using different destroyed-and-replaced guests. Test cancellation, bootstrap failure, controller restart, and lease expiry cleanup.
- Keep the persistent runner registered until replacement proof passes. Its retirement is a separate concrete cleanup action.
- Never weaken source repository required checks while moving LAN jobs. Keep the public gate result tied to the source commit and trusted scanner artifacts.

## References

- [GitHub JIT runner API](https://docs.github.com/en/rest/actions/self-hosted-runners)
- [GitHub runner access controls](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access)
- [GitHub runner network requirements](https://docs.github.com/en/actions/reference/runners/self-hosted-runners#communication)
- [GitHub proxy configuration](https://docs.github.com/en/actions/how-tos/manage-runners/use-proxy-servers)
- [Proxmox administration guide](https://pve.proxmox.com/pve-docs/pve-admin-guide.pdf)
