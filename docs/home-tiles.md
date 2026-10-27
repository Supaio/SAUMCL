# Indev 19.3 启动页磁贴

服务器和游玩日历使用同一套操作：

- 拖动标题栏移动磁贴。
- 拖动右边调整宽度，下边调整高度，右下角同时调整宽高。
- 标题栏或缩放手柄获得键盘焦点后，可用方向键每次移动或调整 8 像素。
- 松开鼠标后保存布局；切换页面、重启启动器后保留。拖动期间失去窗口焦点或取消操作时恢复原布局。

刷新、复制、实例选择和进入服务器等按钮独立于拖动标题栏。磁贴可贴近至 8 像素间距；拖动时其他磁贴保持原位，松手时才将被拖动的磁贴就近放到空位。缩放遇到其他磁贴或屏幕边界时停止扩张，不把其他磁贴推到下面。若找不到可用位置，恢复原位。

磁贴区保持在当前可见屏幕内，不产生额外的整体滚动条；窗口缩小时调整磁贴尺寸，必要时在屏幕内换行。恢复大窗口后使用原本保存的布局，只有主动移动或缩放才保存新布局。日历随尺寸调整留白和日期格，内容确实放不下时在磁贴内部滚动。底部启动按钮保持可见。

首页右上角固定显示 UTC+8 日期，格式为 `2026年10月26日`，下方显示 `12:34:56 UTC+8` 时钟，每秒及页面重新可见时更新。日期、时钟和每日短句统一按 UTC+8 换日，不受设备所选时区影响；时间取自本机时钟。时钟下方每天轮换一句 Minecraft 主题短句，内容在 `public/minecraft-quotes.txt`，每行一条，`#` 开头为注释；修改后随下一次建置生效。预置句子为原创主题文案，没有署名为游戏原文或作者语录。此区域固定在右上方，磁贴不会盖住；窄窗口时将其保留在磁贴上方。

本机布局保存在 WebView 的 `saumcl.homeTiles.layout`，包含格式版本、每个磁贴的稳定 ID、位置和尺寸。首次使用会继承旧服务器磁贴的宽高，旧数据不删除。布局不包含账户、维护 Key 或游戏存档，也不影响其他玩家。

“设置 → 外观 → 显示地球仪”控制日期与短句下方的地球仪，默认关闭。关闭时整个地球仪隐藏，只保留日期与短句；不挂载画布，不读取地图或运行动画。开关使用启动器配置 `appearance.theme.showHomeGlobe` 保存，重启后保留，旧配置缺少此项时也按关闭处理。

地球仪使用冰蓝与蓝灰色配色。地轴只在屏幕平面内固定倾斜约 23.4°，不向观察者俯仰；球体约两分钟自转一周。按住时暂停自转，鼠标或触屏左右拖动只绕该轴转动，松手继续自转。获得焦点后可用左右方向键旋转、Home 复位，不拦截 Esc，也不显示底部操作文字。页面不可见时暂停动画，离开启动页或关闭开关时释放绘制资源。地图随程序内置，不连接在线地图服务。仅使用陆地轮廓，不显示国家边界。轮廓数据由 [Natural Earth 110m land](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson) 提取并保留四位小数，存放于 `public/data/earth-land.json`；原数据为[公有领域数据](https://www.naturalearthdata.com/about/terms-of-use/)。

球体按地球实际自转方向自西向东缓慢转动，从北极上空观察为逆时针。中国图层以柔和红色显示，采用中国主张视角：由 Natural Earth 的 [10m countries](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_admin_0_countries.geojson) 与 [10m disputed areas](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_admin_0_disputed_areas.geojson) 中的 `ADM0_A3_CN=CHN` 要素、港澳及黄岩岛构成，保存于 `public/data/earth-china.json`。涵盖该数据中的台湾、藏南、阿克赛钦、喀喇昆仑走廊及其他相关争议区域；此着色表示选用的主张视角，并非表示争议不存在。小岛保留于数据中，实际可见程度受地球仪尺寸与纹理分辨率限制。该图层同样使用 Natural Earth 的公有领域数据。

南海断续线由 Natural Earth 的 [10m Chinese maritime indicator](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_admin_0_boundary_lines_maritime_indicator_chn.geojson) 提取，保留原始九段独立线段与四位小数坐标，存放于 `public/data/earth-china-maritime.json`。按同一中国主张视角以红色描绘，与球面一起旋转；线段之间保持留白，不连接成实线，也不填满海域。该线层同样为公有领域数据，程序运行时不请求在线地图。

地球仪加入实时昼夜着色和细蓝灰色晨昏线。`src/utils/solar.ts` 根据 [NOAA 近似太阳位置公式](https://gml.noaa.gov/grad/solcalc/solareqns.PDF)，以当前 UTC 时间计算太阳赤纬、均时差和太阳直射点，每秒更新一次。明暗边界取太阳中心高度角为 0° 的几何晨昏线，并加入柔和的过渡；用于界面展示，不模拟天气或地形遮挡。自动自转与手动拖动只改变观察经度，城市所在地的昼夜仍对应真实时间；按住暂停自转时，太阳位置仍随实际时间更新。计算在本地完成，不访问定位或天文接口。

以后新增启动页磁贴，在 `src/models/home-tiles.ts` 中登记 ID、默认和最小尺寸，再在 `HomeTileBoard` 内使用 `HomeTile` 包装内容及标题、按钮。移动、缩放、边界处理与保存统一由公共组件完成，不需要新依赖，也不启用扩展插件。

验证：

```powershell
node --experimental-strip-types scripts/qa/home-tile-regressions.mjs
```
