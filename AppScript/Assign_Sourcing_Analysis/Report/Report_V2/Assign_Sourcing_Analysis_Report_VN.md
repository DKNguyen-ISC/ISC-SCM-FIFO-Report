---
title: Báo cáo phân tích Assign Sourcing (PUBLIC – Chì)
version: V2 – 2026-03
audience: Ban lãnh đạo, phòng Kế hoạch SX, Kho, Mua hàng
---

## 0. Tóm tắt điều hành (Executive Summary)

Hệ thống ISC Supply Chain (M3 + BigQuery) và file Excel “Lead Plan” của PIC Ngàn đang cho ra **số lượng thiếu hụt (shortage) khác nhau**, dù cùng một dữ liệu sản xuất.

Qua phân tích toàn bộ luồng dữ liệu, SQL, Python và cách vận hành thực tế, có **3 nguyên nhân cốt lõi**:

- **P1 – Sai khác về Tolerance (BOM_TOLERANCE vs 10%)**  
  Hệ thống dùng tolerance do CS/HQ gửi (3–4%, có nơi 15–20%), trong khi Lead Plan gần như luôn dùng **10% cố định**. Vì vậy:
  - BOM nào tolerance CS < 10% → hệ thống **tính thiếu** so với Lead Plan.
  - BOM nào tolerance CS > 10% → hệ thống **tính dư** so với Lead Plan.
  - Tổng cộng tạo ra chênh lệch khoảng **~20.900 đơn vị (~4%)** cho nhóm Chì.

- **P2 – Không gom VPO theo BOM (VPO Fragmentation)**  
  Hệ thống đang tính shortage, CEILING theo **từng VPO**, còn Lead Plan gom theo **BOM** rồi mới CEILING một lần. Với các BOM xuất hiện trên nhiều VPO, hệ thống sẽ:
  - Làm **phình lượng đặt mua** vì CEILING lặp đi lặp lại trên từng VPO.
  - Làm **rối mắt planner** vì một BOM phải xử lý nhiều dòng PR.

- **P3 – Thực tế nhập liệu kho theo VPO không chuẩn (Warehouse “lười” chia VPO)**  
  Kho phát vật tư theo pallet/batch lớn, nhưng thường **dồn toàn bộ số phát** vào 1 VPO đầu tiên trên giấy, không chia đúng cho tất cả VPO cùng chạy BOM đó.  
  - Tổng phát theo BOM vẫn đúng, nhưng **phân bổ theo từng VPO bị sai** → một VPO bị “phát quá nhiều”, VPO khác lại “chưa phát gì”.
  - Hệ thống đọc theo VPO nên **hiểu sai shortage** nếu chỉ dựa vào phát kho từng VPO.

**Kết luận chính:**  
Hệ thống **không sai về toán học**, nhưng đang:
- Bám chặt vào BOM_TOLERANCE của CS (P1),
- Không gom BOM theo tính chất PUBLIC (P2),
- Và tin tuyệt đối vào số phát kho theo từng VPO (P3).

Trong khi đó, Lead Plan dùng tư duy vận hành:
- Buffer 10% cố định (dễ hiểu, an toàn),
- Gom shortage theo BOM (giảm trùng lặp, giảm lãng phí CEILING),
- Nhìn tổng phát theo BOM, bỏ qua sai lệch phân bổ VPO.

Nếu muốn **bỏ hẳn Excel Lead Plan** và tin vào hệ thống, cần:
- Thêm **chế độ chọn tolerance** (theo CS hay theo ISC – 10%),
- Thêm **chế độ gom PUBLIC theo BOM** (thay vì theo VPO),
- Thêm **cột kiểm tra thiếu hụt ở cấp BOM** để trung hòa lỗi nhập liệu kho.

---

## 1. Nguyên nhân P1 – Sai khác về Tolerance

### 1.1 Cách hệ thống tính nhu cầu (Demand) hiện tại

Trong view `Material_Demand_VIEW`, hệ thống tính như sau:

```text
GROSS_DEMAND_COMPLETION_METHOD =
  (FINISHED_GOODS_ORDER_QTY - COMPLETION_QTY)
  × BOM_CONSUMPTION
  × (1 + BOM_TOLERANCE)

GROSS_DEMAND_ISSUANCE_METHOD =
  GREATEST(
    0,
    (FINISHED_GOODS_ORDER_QTY × BOM_CONSUMPTION × (1 + BOM_TOLERANCE))
    - CUMULATIVE_ISSUANCE_QTY
  )
```

Trong đó:
- `FINISHED_GOODS_ORDER_QTY`: số lượng thành phẩm cần sản xuất cho VPO đó.
- `COMPLETION_QTY`: số thành phẩm đã làm xong.
- `BOM_CONSUMPTION`: mức tiêu hao vật tư trên 1 đơn vị thành phẩm.
- `BOM_TOLERANCE`: % dư vật tư theo thiết kế (CS/HQ cung cấp).
- `CUMULATIVE_ISSUANCE_QTY`: tổng số lượng vật tư đã phát từ kho cho VPO đó.

### 1.2 BOM_TOLERANCE đến từ đâu?

Luồng dữ liệu:

```text
HQ Trung Quốc → định nghĩa BOM + tolerance cho từng SKU
      ↓
Khách hàng (CS) → gửi BOM + tolerance cho ISC
      ↓
M3 → nạp BOM_TOLERANCE vào BOM_Order_List_Draft
      ↓
SP_SPLIT_BATCH_GATE → đẩy sang BOM_Order_List_Final
      ↓
Material_Demand_VIEW → dùng BOM_TOLERANCE trong công thức demand
```

Đặc điểm:
- `BOM_TOLERANCE` lưu dạng số thực (FLOAT) trong `BOM_Order_List_Final`.
- Giá trị **không cố định**, thay đổi theo cặp `(PRODUCTION_ORDER_ID, BOM_UPDATE)`.  
  → Cùng một BOM, nhưng gắn với VPO khác nhau có thể có TOLERANCE khác nhau (3%, 5%, 12%, 18%…).

### 1.3 Cách Lead Plan (Ngàn) tính nhu cầu

Trong file Excel Lead Plan:

- **Không dùng** BOM_TOLERANCE từ CS.
- Dùng một quy ước nội bộ ISC:

| Tham số         | Hệ thống (CS)                          | Lead Plan (ISC)                  |
|-----------------|----------------------------------------|----------------------------------|
| Giá trị tol.    | Thay đổi theo VPO (3%, 5%, 7%, 15%…)   | **10% cố định** (đa số BOM)     |
| Nguồn           | CS / HQ                               | Quy ước nội bộ ISC              |
| Ngoại lệ        | Có BOM tới 15–20%                     | Một ít BOM đặc biệt dùng 20%    |
| Mức chi tiết    | Theo (VPO, BOM)                        | Theo BOM (ít thay đổi hơn)      |

**Công thức Lead Plan:**

```text
Demand_LeadPlan = (Order Qty - Completed Qty)
                  × BOM Consumption
                  × (1 + 10%)
```

### 1.4 Ví dụ minh họa – BOM `302014740`

Với VPO `V2512031C01`:
- `Order Qty = 32`
- `Consumption = 0.166667`

Nếu:
- **Hệ thống (CS tolerance = 3%)**  
  → `(32 - 0) × 0.166667 × 1.03 ≈ 5.49` đơn vị

- **Lead Plan (ISC 10%)**  
  → `(32 - 0) × 0.166667 × 1.10 ≈ 5.87` đơn vị

→ Chỉ riêng BOM này, hệ thống **tính thiếu hơn** Lead Plan khoảng 6.9%.

### 1.5 Tác động tổng thể

Khi cộng dồn nhiều BOM:
- Một số BOM có CS tolerance < 10% → hệ thống **thiếu** so với Lead Plan.
- Một số BOM có CS tolerance > 10% → hệ thống **dư** so với Lead Plan.

Theo kết quả truy vấn SQL và Python, với nhóm Chì:
- Sai khác tổng cộng khoảng **20.900 đơn vị (~4%)**.

### 1.6 Ý nghĩa kinh doanh

- Tolerance của CS/HQ mang tính **kỹ thuật**: phản ánh thiết kế chuẩn.
- Tolerance 10% của ISC mang tính **vận hành**: đơn giản, dễ giải thích, an toàn.
- Không bên nào “sai”, nhưng nếu hệ thống **chỉ** cho phép một cách tính thì sẽ luôn lệch với thực tế planner đang dùng.

**Kết luận P1:**  
Muốn số shortage trong hệ thống gần giống Lead Plan, cần:
- Cho phép **chọn cách tính tolerance** (CS hay ISC), ít nhất là ở cấp phiên làm việc (session).

---

## 2. Nguyên nhân P2 – Không gom VPO theo BOM (VPO Fragmentation)

### 2.1 Hành vi hiện tại của `Assign_Sourcing`

Hiện tại, mỗi dòng trong session tương ứng với một cặp:

```text
DRAFT_PR_ID ~ (BOM_UPDATE, VPO)
```

Ví dụ BOM `302023503` xuất hiện 2 lần:

```text
Row 1: BOM = 302023503, VPO = V2601015C01, NET_SHORTAGE = 14.3157
Row 2: BOM = 302023503, VPO = V2512007C06, NET_SHORTAGE = 531.0976
Tổng shortage BOM = 14.3157 + 531.0976 ≈ 545.4133
```

Mỗi dòng có:
- `FINAL_ORDER_QTY` = CEILING(NET_SHORTAGE, SPQ),
- Nhà cung cấp,
- Giá, ngày giao hàng…

### 2.2 Công thức CEILING trong file sourcing

Hiện tại:

```text
FINAL_ORDER_QTY = CEILING(
  NET_SHORTAGE_QTY,
  STANDARD_MOQ_REF
)
```

Trong đó:
- `STANDARD_MOQ_REF` thực chất là **SPQ (Standard Package Quantity)**:
  - Ví dụ: SPQ = 600 → chỉ đặt 600, 1.200, 1.800, …
  - Dù trong DB đang đặt tên là MOQ.

**Ví dụ với SPQ = 600:**

- Cách hiện tại (theo từng VPO):

```text
VPO 1: shortage = 14.3157 → CEILING(14.3157, 600) = 600
VPO 2: shortage = 531.0976 → CEILING(531.0976, 600) = 600
Tổng đặt: 600 + 600 = 1.200
```

- Cách gom theo BOM:

```text
Tổng shortage = 545.4133
→ CEILING(545.4133, 600) = 600
Tổng đặt: 600
Tiết kiệm: 600 đơn vị (giảm 50%)
```

### 2.3 Vì sao cần gom theo BOM cho PUBLIC?

Nhóm vật tư như Chì có tính chất:
- Hàng **PUBLIC**, dùng chung cho nhiều VPO.
- Không cần bám quá chặt theo từng VPO; quan trọng là **tổng nhu cầu cho BOM đó**.

Nếu:
- Cứ giữ từng VPO riêng lẻ → hệ thống:
  - Lãng phí CEILING (đặt gấp đôi/gấp ba nếu nhiều VPO nhỏ).
  - Tạo nhiều dòng PR → tốn thời gian duyệt.

- Gom theo BOM:
  - Order theo tổng shortage BOM → **ít CEILING lặp**.
  - Planner chỉ xem **1 dòng / 1 BOM** → đơn giản hơn nhiều.

### 2.4 Đề xuất cấu trúc session mới cho PUBLIC

Khi `FULFILLMENT_MODE = PUBLIC`:

- **Hiện tại (VPO-level):**

```text
DRAFT_PR_ID | BOM_UPDATE | VPO         | NET_SHORTAGE | FINAL_ORDER_QTY
----------- | ---------- | ----------  | ------------ | --------------
PRD_...     | 302023503  | V2601015C01 | 14.32        | 600
PRD_...     | 302023503  | V2512007C06 | 531.10       | 600
Tổng đặt: 1.200
```

- **Đề xuất (BOM-level, gom VPO):**

```text
DRAFT_PR_ID   | BOM_UPDATE | VPOs                       | TOTAL_SHORTAGE | FINAL_ORDER_QTY
AGG_302023503 | 302023503  | V2601015C01|V2512007C06   | 545.42         | 600
Tổng đặt: 600
```

Thay đổi chính:
- Cột VPO chứa **danh sách VPO** (ngăn cách bằng `|`).
- `NET_SHORTAGE_QTY` là **tổng shortage của tất cả VPO** cho BOM đó.
- `REQUESTED_DELIVERY_DATE` = **ngày sớm nhất** trong các VPO.

### 2.5 Ảnh hưởng lên upload PR

Khi bấm “Upload quyết định Sourcing”:

- Có vài phương án:
  - **Phương án A – 1 PR / 1 BOM (đơn giản nhất)**  
    - PR_Staging lưu VPO = `NULL` hoặc `MULTI`.  
    - Các bước sau hiểu đây là đơn hàng PUBLIC, phục vụ nhiều VPO.

  - **Phương án B – Nổ lại theo VPO (giữ traceability)**  
    - Khi upload, hệ thống chia lại số lượng order theo tỷ lệ shortage từng VPO, tạo nhiều dòng trong PR_Staging.
    - Vẫn giữ được chuỗi VPO → PO phục vụ traceability.

  - **Phương án C – Lưu luôn danh sách VPO trong 1 trường (pipe-delimited)**  
    - `PR_Staging.VPO = 'VPO1|VPO2|...'`.
    - Engine hợp đồng/PO xử lý dạng multi-VPO.

Chi tiết trade-off đã được mô tả kỹ trong Part 1 và Part 2, nhưng điểm chính:
- Với vật tư PUBLIC, **gom BOM cấp cao** giúp:
  - Giảm lãng phí SPQ,
  - Giảm tải cho planner,
  - Vô hiệu hóa phần lớn lỗi nhập liệu kho theo VPO (P3).

---

## 3. Nguyên nhân P3 – Lỗi nhập liệu kho theo VPO (Warehouse Issuance “Laziness”)

### 3.1 Cách kho đang nhập liệu

Luồng dữ liệu kho:

```text
Sheet Google “5. Link Lead plan”
  ↓ (M4 Lead_Issuance_AutoSync)
Sheet trung gian “6. Link Cấp Phát”
  ↓
Material_Issuance (BOM_UPDATE, VPO, CUMULATIVE_ISSUANCE_QTY)
```

Trong sheet:
- Hàng: BOM_UPDATE,
- Cột: từng VPO,
- Ô: số lượng phát cho BOM đó – VPO đó.

**Kỳ vọng đúng:**

```text
VPO1: BOM 302023503 phát 14
VPO2: BOM 302023503 phát 530
→ mỗi VPO có số phát đúng nhu cầu.
```

**Thực tế quan sát:**

```text
VPO1: BOM 302023503 phát 0
VPO2: BOM 302023503 phát 544
→ Tổng 544 vẫn đúng BOM, nhưng chia cho VPO bị lệch.
```

Lý do:
- Cùng một BOM, nhiều VPO sản xuất trong 1 ngày.
- Kho phát từ 1 pallet lớn, không ngồi chia lại chính xác cho từng VPO.
- Người nhập liệu thường **dồn hết vào 1 VPO** để đỡ tốn thời gian.

### 3.2 Hệ quả với hệ thống

Khi hệ thống đọc dữ liệu như vậy:
- VPO bị dồn số phát lớn:
  - Nhìn như được cấp **quá nhiều** so với demand → hệ thống tính **không còn shortage** hoặc thậm chí giống dư.
- VPO khác (thực ra có dùng vật tư) nhưng bị ghi 0:
  - Nhìn như **chưa phát gì** → hệ thống tính **shortage rất lớn**.

Quan trọng:
- **Tổng phát theo BOM** vẫn đúng → số vật tư thực tế ra khỏi kho là hợp lý.
- Chỉ sai ở bước **phân bổ theo VPO**.

### 3.3 Liên hệ với P2

Nếu vẫn bám theo VPO:
- Hệ thống sẽ luôn bị nhiễu bởi thói quen nhập liệu kho (dồn vào 1 VPO).
- Lead Plan thì không bị ảnh hưởng, vì planner:
  - Nhìn tổng phát theo BOM,
  - Bỏ qua phân bổ VPO chi tiết.

Nếu gom ở mức BOM (P2):
- Dùng công thức:

```text
BOM_LEVEL_TOTAL_SHORTAGE
  = Tổng GROSS_DEMAND (theo BOM)
  - Tổng ISSUANCE (theo BOM)
  - (Tồn kho + PO đang về cho BOM)
```

- Lúc này:
  - VPO nào bị dồn số phát lớn hay bị ghi 0 **không còn quan trọng**.
  - Chỉ cần tổng phát cho BOM đó là đúng → system shortage vẫn đúng.

**Kết luận P3:**  
Kho khó thay đổi thói quen nhập (vì tốn công, không có kiểm soát hệ thống mạnh).  
Do đó, giải pháp bền vững là:
- **Đưa logic tính shortage về cấp BOM**, không dựa quá nhiều vào “đúng từng VPO”.

---

## 4. Tóm tắt logic kiểm chứng (Python & SQL)

Các file Part 2 và Part 3 mô tả chi tiết:
- Cách dùng Python + BigQuery để kiểm chứng toàn bộ giả thuyết P1, P2, P3.
- Bộ 20 câu SQL để chạy trực tiếp trên BigQuery Console.

Mục tiêu các truy vấn:
- **Nhóm A (P1):**  
  - Thống kê phân bố BOM_TOLERANCE cho Chì.  
  - So sánh tổng demand khi dùng BOM_TOLERANCE CS vs dùng 10% cố định.  
  - Đào sâu các BOM lệch nhiều nhất (như 302014740).

- **Nhóm B (P2):**  
  - Liệt kê BOM xuất hiện trên nhiều VPO.  
  - Tính tổng lượng “lãng phí” khi CEILING theo từng VPO so với CEILING sau khi cộng tổng.  
  - Tính tổng tiết kiệm nếu gom tất cả BOM PUBLIC.

- **Nhóm C (P3):**  
  - So sánh tổng phát theo BOM với tổng demand theo BOM.  
  - Tìm các VPO bị phát nhiều hơn demand (dấu hiệu dồn phát).  
  - Kiểm tra tính nhất quán giữa tổng phát theo BOM và tổng phát cộng dồn theo VPO.

Kết quả các truy vấn đều **ủng hộ 3 nguyên nhân P1, P2, P3** đã trình bày ở trên.

---

## 5. Đề xuất thay đổi hệ thống (Giải pháp)

### 5.1 Giải pháp cho P1 – “Tolerance Disconnect”

**Mục tiêu:**  
Cho phép planner chọn cách tính tolerance giống Lead Plan khi cần, thay vì bị khóa theo BOM_TOLERANCE từ CS.

**Đề xuất:**

- Thêm cấu hình trong UI `Assign_Sourcing`:
  - **Chế độ 1 – Dùng tolerance CS (hiện tại):**
    - Dùng `BOM_TOLERANCE` từ `BOM_Order_List_Final`.
  - **Chế độ 2 – Dùng chuẩn ISC 10%:**
    - Override toàn bộ `BOM_TOLERANCE` = 0.10 trong quá trình tính demand cho session.
  - (Tùy chọn nâng cao) **Chế độ 3 – Custom tolerance cho phiên:**
    - Cho phép nhập 1 con số (ví dụ 12%) áp dụng cho toàn bộ BOM trong session đó.

- Hiển thị rõ chế độ đang dùng trên Dashboard của session:
  - Ví dụ:  
    - `TOLERANCE_MODE = CS`  
    - hay `TOLERANCE_MODE = ISC_10%`.

Lợi ích:
- Khi muốn đối chiếu với Lead Plan, planner chỉ cần chọn “ISC 10%” → số shortage trong hệ thống sẽ gần với Excel hơn, dễ giải thích với sếp.

### 5.2 Giải pháp cho P2 – “VPO Fragmentation”

**Mục tiêu:**  
Giảm lãng phí SPQ và giảm số dòng PR phải xử lý, bằng cách gom PUBLIC theo BOM.

**Đề xuất:**

- Khi group vật tư là PUBLIC (vd. Chì):
  - Sử dụng **view/tầng gom** để:
    - Gom các dòng PR_Draft có cùng `BOM_UPDATE` thành 1 dòng trong session.
    - Cộng các `NET_SHORTAGE_*` lại thành `TOTAL_SHORTAGE`.
    - Gộp danh sách VPO vào một cột (pipe-delimited).
    - Lấy ngày giao hàng sớm nhất trong các VPO.

- Bổ sung **dashboard chỉ số**:
  - `UNIQUE_BOM_COUNT`: số BOM khác nhau trong session.
  - `AGGREGATION_MODE`: `PUBLIC_AGGREGATED` hoặc `PRIVATE_VPO_LEVEL`.
  - `TOTAL_MOQ_SAVINGS`: tổng chênh lệch giữa:
    - “Tổng CEILING theo từng VPO”
    - và “CEILING của tổng shortage BOM”.

Lợi ích:
- Planner:
  - Thay vì phải xem 97 dòng VPO, chỉ cần xem **ít dòng BOM** hơn.
  - Dễ dàng thấy BOM nào thật sự thiếu nhiều, tập trung xử lý.
- Hệ thống:
  - Giảm **double/triple CEILING**, tránh đặt mua dư không cần thiết.

### 5.3 Giải pháp cho P3 – “Warehouse Issuance Reliance”

**Mục tiêu:**  
Không để chất lượng nhập liệu theo VPO của kho làm hỏng kết quả shortage.

**Đề xuất:**

- Thêm một cột **“BOM-Level Total Shortage”** trong session:

```text
BOM_TOTAL_SHORTAGE
  = Tổng demand theo BOM
  - Tổng issuance theo BOM
  - (Tồn kho + PO đang về cho BOM)
```

- Hiển thị song song với shortage theo từng VPO:
  - Planner có thể so sánh:
    - Nếu tổng shortage theo BOM ≈ tổng shortage do cộng VPO → dữ liệu ổn.
    - Nếu lệch lớn → cảnh báo lỗi nhập kho theo VPO.

- Kết hợp với giải pháp gom PUBLIC theo BOM (P2):
  - Khi đã gom cấp BOM, chỉ số này trở thành **số shortage chính** để ra quyết định đặt mua.

Lợi ích:
- Hệ thống không phải “phạt” kho vì nhập liệu không chuẩn theo VPO, nhưng vẫn đảm bảo **tính đúng số cần mua** ở cấp BOM.

---

## 6. Hướng dẫn đọc báo cáo (dành cho lãnh đạo bận rộn)

- **Nếu chỉ có 5 phút:**
  - Đọc mục **0 – Tóm tắt điều hành** để nắm:
    - 3 nguyên nhân chính (P1, P2, P3),
    - 3 nhóm giải pháp (Tolerance mode, BOM aggregation, BOM-level check).

- **Nếu có 15–20 phút:**
  - Đọc thêm:
    - **Mục 1**: Hiểu vì sao tolerance khác nhau tạo ra chênh lệch,
    - **Mục 2**: Hiểu vì sao không gom BOM làm order bị phình,
    - **Mục 3**: Hiểu vì sao nhập liệu kho theo VPO không nên là “nguồn sự thật” duy nhất.

- **Nếu muốn triển khai ngay:**
  - Chuyển cho team kỹ thuật:
    - File **Part1_Assign_Sourcing_Analysis.md** (giải thích nghiệp vụ chi tiết),
    - **Part 2 & Part 3** (Python + SQL) để họ dùng làm checklist triển khai và kiểm thử.

---

## 7. Kết luận chung

1. Hệ thống hiện tại **đúng theo dữ liệu CS/HQ** nhưng **không khớp tư duy vận hành** của planner (Lead Plan).
2. Có thể **đưa hai thế giới lại gần nhau** bằng 3 thay đổi kỹ thuật khá rõ ràng:
   - Cho phép chọn tolerance 10% như Lead Plan (P1),
   - Gom PUBLIC theo BOM để giảm lãng phí và đơn giản hóa UI (P2),
   - Dùng shortage cấp BOM để “che chắn” lỗi nhập liệu kho theo VPO (P3).
3. Sau khi áp dụng 3 thay đổi trên, file Excel Lead Plan của Ngàn có thể:
   - Giảm vai trò xuống chỉ còn công cụ backup,
   - Hoặc dần **loại bỏ**, nếu quản lý tin tưởng dashboard và báo cáo từ hệ thống mới.

> **Thông điệp cuối:**  
> Hệ thống không cần “thắng” Excel về toán học, mà cần **bắt chước cách planner đang suy nghĩ và ra quyết định**, nhưng làm nó **nhanh hơn, ít thao tác hơn và kiểm soát tốt hơn**.

