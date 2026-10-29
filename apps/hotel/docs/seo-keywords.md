# Keyword plan (per hotel)

Write for guests first. Each keyword goes where a person would naturally read it; never repeat one more than twice on a page.
Replace `{city}`, `{Hotel}` per hotel (brand spellings come from `src/lib/seo.ts`: "MM Hotel Tandag (MMHotel)").

## Terms
| Type | Examples |
|---|---|
| Brand | `{Hotel} {city}`, `{Hotel} booking`, `{Hotel} official website` |
| Head | `hotel in {city}`, `{city} hotel booking`, `book hotel {city} online` |
| Long-tail (rooms) | `family room {city}`, `affordable hotel near {landmark}`, `{room type} {city}` |
| Long-tail (amenities) | `hotel with pool {city}`, `hotel with free wifi {city}`, `function hall {city}` |
| Dining / events | `restaurant {city}`, `meeting room {city}`, `events venue {city}` |

## Where each goes
| Page | Title / h1 | Description | Body |
|---|---|---|---|
| Home | brand + "Official Website & Online Booking" (auto) | Tagline: one head term + one amenity | Hero subtitle, room descriptions |
| Room page | `{room} — {brand}` (auto) | Room description (first 155 chars: lead with room type + city + one amenity) | Photo alt text with room name |
| Dining | "Restaurant & Dining" (auto) | Cuisine + `{city}` | Menu item names |
| Meetings & Events | "Meetings & Events" (auto) | Capacity + `{city}` | Hall names and sizes |
| Contact | "Contact Us" (auto) | Address, directions from airport/terminal | Landmarks nearby |

Edit these in the hotel's branding config (`tagline`, `heroSubtitle`) and room-type descriptions.

## What actually moves rankings
- Google Search Console: submit `/sitemap.xml`, check indexing and the queries people really use.
- Google Business Profile: complete it, keep NAP (name, address, phone) identical to the contact page.
- Real guest reviews, plus links from local listings and tourism pages.
- Page speed (compress hero images) and mobile layout.
