# dPack Ownership Proof Flow

This describes a process for asserting ownership of a dPack by writing a pre-defined payload, then syncing the dPack to dHostd.

> This spec was originally part of the registration flow. It's now being preserved, as a general-purpose flow, until we have a deployment plan for it.

## Step 1. Claim ownership (POST /v2/vaults/claim)

User POSTS `/v2/vaults/claim` while authenticated with body (JSON):

```
{
  key: String, they key of the dPack, or
  url: String, the url of the dPack
}
```

Server generates the `proof` (a non-expiring JWT) with the following content:

```
{
  id: String, id of the user
  url: String, the URL of the dPack
}
```

Server responds 200 with the body:

```
{
  proof: String, the encoded JWT
  hostname: String, the hostname of this service
}
```

## Step 2. Write proof

User writes the `proof` to the `/proofs/:hostname` file of their profile dPack. User then syncs the updated dPack to the service.

User GETS `/v2/vaults/item/:key?view=proofs` periodically to watch for successful sync.

## Step 3. Validate claim

Server receives proof-file in the dPack. After checking the JWT signature, the server updates vault record to indicate the verified ownership.
