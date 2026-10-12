# 16 · 云资源获取步骤（新手版）

核对日期：2026-10-12。目标为EdgeOne Pages国际站my-site，Git主分支main。这里只准备资源，不代表已经完成生产部署。

## 一、先打开本地配置文件

用编辑器打开项目根目录的.env.edgeone.local。保留原有EDGEONE_API_TOKEN，在下面追加配置，不能覆盖.env或把真实凭据发到聊天。该文件已被Git忽略。暂时没有的值留空，不把示例当成实际值。

## 二、创建云数据库

1. 打开 https://supabase.com/dashboard ，注册或登录；可使用GitHub账号。
2. 创建组织（如果界面要求），选择套餐。先验证可选Free，但官方注明闲置一周会暂停且不含自动数据库备份。正式长期运行再决定套餐，Pro官方起价25美元/月，额外用量另计，以结算页为准，不要求现在购买。
3. 点击New project，名称填my-site，区域选择Southeast Asia (Singapore)。若有精确区域选项，选择ap-southeast-1。选择强数据库密码并保存；不是Supabase登录密码。
4. 等项目创建完成。在项目顶部点击Connect，类型选择URI。
5. 选择Transaction pooler，复制连接串，通常包含端口6543，存到本地DATABASE_URL。
6. 再选择Session pooler，复制连接串，通常包含端口5432，存到本地MIGRATION_DATABASE_URL。它用于迁移/维护，避免Windows或云端没有IPv6时误用仅支持IPv6的直连地址。
7. 若复制内容包含[YOUR-PASSWORD]，先保留占位，并将真实数据库密码单独存入SUPABASE_DATABASE_PASSWORD。由开发者在本地完成密码URL编码与连接串组合；该占位连接串尚不可部署。
8. 不需要复制anon/publishable/service_role等API key，也不要手工建业务表、执行reset或照通用教程重新初始化Prisma。开发者会检查数据库版本、创建独立运行角色、部署已有迁移并验证权限和连接池参数。

```dotenv
# 粘贴Connect页面复制的原始连接串；若带密码占位，由开发者在本地补齐
DATABASE_URL=""
MIGRATION_DATABASE_URL=""
# 仅当连接串尚未包含真实密码时填写；不会传入公开前端
SUPABASE_DATABASE_PASSWORD=""
```

完成标志：项目显示可用，两个连接串和必要的数据库密码已经保存在本地。数据库只有创建成功还不算项目已验收。

参考：[套餐](https://supabase.com/pricing)、[Prisma连接](https://supabase.com/docs/guides/database/prisma)、[备份](https://supabase.com/docs/guides/platform/backups)。

## 三、开通R2并创建桶

“桶”可以理解成独立文件库。三个桶各有用途：网站媒体、临时上传、独立备份。

1. 打开 https://dash.cloudflare.com ，注册或登录。
2. 进入Storage & databases → R2 → Overview，按页面完成R2开通。它是按用量计费服务，有免费额度，具体支付方式及收费以开通页面为准，不等于无限免费。
3. 点击Create bucket，分别创建my-site-media、my-site-upload-private、my-site-backup-private。存储类别选Standard；首次不选特殊司法辖区选项，使用常规S3 Endpoint。
4. 三个桶初始均保持私有。后续仅my-site-media允许公开读取；另外两个桶始终不启用Public Development URL或Custom Domains。
5. 进入R2的API token管理入口（界面可能叫Manage API Tokens），创建R2专用Token，名称my-site-app。
6. 权限选择Object Read & Write，限定my-site-media和my-site-upload-private两个桶。
7. 保存结果中的Access Key ID和Secret Access Key。Secret Access Key只展示一次。项目需要这两个S3凭据，不是把Cloudflare通用Token直接填进去。
8. 复制页面提供的S3 API Endpoint，常规形如https://账户ID.r2.cloudflarestorage.com。它与公开媒体访问地址不同，不能互换。
9. 如准备独立备份，再创建my-site-backup Token，Object Read & Write仅限my-site-backup-private；备份密钥与网站运行密钥分开。

```dotenv
STORAGE_DRIVER=s3
S3_REGION=auto
S3_BUCKET=my-site-media
S3_PRIVATE_BUCKET=my-site-upload-private
S3_ENDPOINT=""
S3_ACCESS_KEY_ID=""
S3_SECRET_ACCESS_KEY=""
# 独立备份任务用，不传给网站运行进程
BACKUP_S3_BUCKET=my-site-backup-private
BACKUP_S3_ACCESS_KEY_ID=""
BACKUP_S3_SECRET_ACCESS_KEY=""
```

完成标志：三个桶已创建，应用和备份各自的S3凭据已保存在本地，临时桶与备份桶不公开。开发者只持有对象权限，不能用这些密钥修改桶配置；后续CORS等设置需要用户在控制台粘贴审核后的配置。

参考：[R2开通](https://developers.cloudflare.com/r2/get-started/)、[S3凭据](https://developers.cloudflare.com/r2/api/tokens/)。

## 四、准备公开媒体地址与网站域名

### 先验证上传

进入my-site-media → Settings → Public Development URL，启用并复制https://…r2.dev地址，存到S3_PUBLIC_BASE_URL。只在这个媒体桶操作。这个地址用于开发验证，官方不建议生产使用，正式上线前更换为媒体自定义域名。

```dotenv
S3_PUBLIC_BASE_URL=""
```

### 正式媒体域名

1. 若已有域名，只告诉开发者域名名称及当前DNS服务商，不发送账号密码；建议网站www.你的域名，媒体media.你的域名。
2. R2自定义域名要求该域名作为zone加入同一Cloudflare账号。若尚未接入，先核对现有DNS记录，保留网站和邮箱记录，再按Cloudflare指引添加域名；不要直接删除记录或盲改NS。
3. 域名已接入后，在my-site-media → Settings → Custom Domains → Add填写media.你的域名，确认新增DNS记录，等待Active。
4. 将S3_PUBLIC_BASE_URL改为https://media.你的域名。不要把r2.dev做CNAME伪装成生产域名。
5. 网站域名接EdgeOne，与媒体域名接R2是两条独立记录。网站的准确CNAME由my-site控制台提供，开发者核对后再给用户填写；不猜测目标地址。

没有域名时可以先完成二、三和临时媒体验证。网站能否先使用平台域名需核对my-site实际分配情况；R2正式公开地址仍需生产方案。此时告诉开发者“暂无域名”，先确认方案再购买。

CORS必须按最终网站Origin配置。开发者会提供可复制JSON，用户粘贴到临时上传桶及需要跨域读取的媒体桶；不先设置全来源通配。

参考：[R2公开桶、临时地址及域名要求](https://developers.cloudflare.com/r2/buckets/public-buckets/)、[CORS](https://developers.cloudflare.com/r2/buckets/cors/)。

## 五、不需要用户手工写代码的部分

| 缺失项 | 用户需要做什么 | 开发者后续工作 |
|---|---|---|
| JWT/任务密钥 | 不需要自行生成，不发聊天 | 本地生成独立随机值并配置到正确环境 |
| 管理员 | 告知要使用的管理员邮箱 | 安全初始化，不使用开发默认密码上线 |
| 数据库迁移 | 完成数据库资源和本地凭据 | 核对版本/权限、创建运行角色、执行已有迁移 |
| 每分钟发布、每日维护 | 不需要购买第三个调度平台 | 使用Supabase Cron/pg_net/Vault配置并记录真实HTTP结果 |
| 数据库与媒体备份 | 完成私有备份桶及独立密钥，确认保留策略 | 选择持续在线的执行环境，配置加密备份与隔离恢复；仅建桶不算完成备份 |
| 健康告警 | 告知希望接收告警的邮箱或现有监控平台 | 提供监控配置并验证；发送测试通知前按既有授权要求另确认 |
| Pages兼容和性能 | 无需手工处理 | 验证Node/Prisma/middleware、媒体协议、登录权限、CSP及G性能 |
| 网站HTTPS与CORS | 按开发者提供的准确记录/JSON操作 | 确认平台域名、Origin、canonical、证书及API权限 |

调度可以直接利用Supabase，不代表独立备份任务已有持续在线执行环境；部署前需实际选定并验证，必要时另提供费用方案。

## 六、完成后的交接

只在聊天回复：数据库已创建、R2已创建、本地凭据已填写、域名名称或暂无域名、管理员/告警邮箱。不要发送文件全文、数据库密码或Token。

开发者先检查和准备可审阅发布候选，不能承诺Pages全栈兼容已通过。CLI1.6.41实测新项目先要production才能preview，所以第一次公开production部署前仍需用户最终确认；资源开通、填写凭据和Git push不自动代表该确认。
