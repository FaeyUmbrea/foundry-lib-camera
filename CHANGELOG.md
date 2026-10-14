# Changelog

## 1.14.3

- Credit theripper93 for 3D Canvas in Camera Controls, module details and the README.

## 1.14.2

- Follow multiple users through shared camera ownership, using the latest changed viewport.
- Observe and follow native 3D views, and report 3D camera availability through the API and status hook.
- Fit the full scene through a consumer or an existing camera session.
- Frame tokens from stable document coordinates during redraws and floor changes.
- Keep following when a source briefly selects an unavailable floor.

## 1.14.1

- Fix startup, remote camera movement and viewport subscriptions on plain HTTP addresses.

## Initial release — 1.13.0 and 1.14.0

- Shared camera ownership, priorities, explicit claims and cancellation.
- Immediate and animated movement, token framing, scene bounds and viewport following.
- Scene-level transitions on Foundry 14.
- Authorized remote control across all sessions belonging to a user.
- Optional 3D Canvas position and viewing-target support in free-camera mode.
- Native camera controls with local and world-wide stop actions.

Foundry 13 requires build 13.351 or later. The Foundry 14 release is verified
with build 14.363. Both require libWrapper. 3D Canvas is optional.
