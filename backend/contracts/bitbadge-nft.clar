(impl-trait 'ST3QFME3CANQFQNR86TYVKQYCFT7QX4PRXM1V9W6H.sip009-nft-trait.sip009-nft-trait)

(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u100))
(define-constant err-not-token-owner (err u101))
(define-constant err-not-found (err u102))
(define-constant err-unsupported-tx (err u103))
(define-constant err-out-not-found (err u104))
(define-constant err-in-not-found (err u105))
(define-constant err-tx-not-mined (err u106))

(define-non-fungible-token bitbadge uint)

(define-data-var last-token-id uint u0)

(define-read-only (get-last-token-id)
    (ok (var-get last-token-id))
)

(define-read-only (get-token-uri (token-id uint))
    (ok none)
)

(define-read-only (get-owner (token-id uint))
    (ok (nft-get-owner? bitbadge token-id))
)

(define-public (transfer (token-id uint) (sender principal) (recipient principal))
    (begin
        (asserts! (is-eq tx-sender sender) err-not-token-owner)
        (nft-transfer? bitbadge token-id sender recipient)
    )
)

(define-public (mint (recipient principal) (height uint) (tx (buff 1024)) (header (buff 80)) (proof { tx-index: uint, hashes: (list 14 (buff 32)), tree-depth: uint}))
    (let
        (
            (token-id (+ (var-get last-token-id) u1))
            (tx-was-mined (try! (contract-call? .clarity-bitcoin was-tx-mined-compact height tx header proof)))
        )
        (asserts! (is-eq tx-sender contract-owner) err-owner-only)
        (asserts! (is-eq tx-was-mined true) err-tx-not-mined)
        (try! (nft-mint? bitbadge token-id recipient))
        (var-set last-token-id token-id)
        (ok token-id)
    )
)